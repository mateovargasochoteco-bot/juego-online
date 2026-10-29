const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const servidor = http.createServer(app);
const io = new Server(servidor);

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));

const salas = new Map();

const MAX_JUGADORES = 4;
const TIEMPO_CONTAR = 15;
const TIEMPO_BUSCAR = 100;

const ANCHO_MAPA = 2050;
const ALTO_MAPA = 1700;

const MUSICAS = [
    "/img/gd1.mp3",
    "/img/gd2.mp3",
    "/img/gd3.mp3"
];

const POSICIONES_INICIALES = [
    { x: 150, y: 150 },
    { x: 850, y: 700 },
    { x: 1500, y: 1300 },
    { x: 1100, y: 300 }
];

function generarCodigo() {
    const caracteres = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let codigo = "";

    for (let i = 0; i < 5; i++) {
        codigo += caracteres[
            Math.floor(Math.random() * caracteres.length)
        ];
    }

    return codigo;
}

function elegirMusica() {
    return MUSICAS[Math.floor(Math.random() * MUSICAS.length)];
}

function obtenerJugadores(sala) {
    return Array.from(sala.jugadores.values()).map(jugador => ({
        id: jugador.id,
        nombre: jugador.nombre,
        x: jugador.x,
        y: jugador.y,
        rol: jugador.rol,
        atrapado: jugador.atrapado
    }));
}

function enviarEstado(codigo) {
    const sala = salas.get(codigo);
    if (!sala) return;

    let mensaje = "Esperando jugadores...";

    if (sala.fase === "contando") {
        mensaje = "¡El buscador está contando! Escóndanse.";
    } else if (sala.fase === "buscando") {
        mensaje = "¡El buscador tiene que encontrarlos!";
    } else if (sala.fase === "terminada") {
        mensaje = "La partida terminó.";
    }

    io.to(codigo).emit("estadoSala", {
        codigo,
        jugadores: obtenerJugadores(sala),
        fase: sala.fase,
        tiempoRestante: sala.tiempoRestante,
        mensaje,
        musica: sala.musica
    });
}

function iniciarPartida(codigo) {
    const sala = salas.get(codigo);
    if (!sala || sala.jugadores.size !== MAX_JUGADORES) return;
    if (sala.fase !== "esperando") return;

    const jugadores = Array.from(sala.jugadores.values());

    // Elegir un buscador al azar.
    const indiceBuscador = Math.floor(Math.random() * jugadores.length);

    jugadores.forEach((jugador, indice) => {
        jugador.rol = indice === indiceBuscador
            ? "buscador"
            : "escondido";

        jugador.atrapado = false;

        // Ubicar a cada jugador en una zona diferente del mapa.
        jugador.x = POSICIONES_INICIALES[indice].x;
        jugador.y = POSICIONES_INICIALES[indice].y;
    });

    sala.fase = "contando";
    sala.tiempoRestante = TIEMPO_CONTAR;
    sala.musica = elegirMusica();

    enviarEstado(codigo);

    sala.intervalo = setInterval(() => {
        const salaActual = salas.get(codigo);

        if (!salaActual) return;

        if (
            salaActual.fase !== "contando" &&
            salaActual.fase !== "buscando"
        ) {
            return;
        }

        salaActual.tiempoRestante--;

        if (
            salaActual.fase === "contando" &&
            salaActual.tiempoRestante <= 0
        ) {
            salaActual.fase = "buscando";
            salaActual.tiempoRestante = TIEMPO_BUSCAR;
        } else if (
            salaActual.fase === "buscando" &&
            salaActual.tiempoRestante <= 0
        ) {
            terminarPartida(
                codigo,
                "¡Ganaron los que se escondían!",
                "El buscador no logró encontrar a todos en 100 segundos."
            );
            return;
        }

        enviarEstado(codigo);
    }, 1000);
}

function terminarPartida(codigo, titulo, detalle) {
    const sala = salas.get(codigo);
    if (!sala || sala.fase === "terminada") return;

    sala.fase = "terminada";

    if (sala.intervalo) {
        clearInterval(sala.intervalo);
        sala.intervalo = null;
    }

    io.to(codigo).emit("finPartida", {
        titulo,
        detalle
    });

    enviarEstado(codigo);
}

function todosAtrapados(sala) {
    const escondidos = Array.from(sala.jugadores.values())
        .filter(jugador => jugador.rol === "escondido");

    return escondidos.length > 0 &&
        escondidos.every(jugador => jugador.atrapado);
}

function comprobarCaptura(codigo) {
    const sala = salas.get(codigo);
    if (!sala || sala.fase !== "buscando") return;

    const jugadores = Array.from(sala.jugadores.values());
    const buscador = jugadores.find(jugador =>
        jugador.rol === "buscador"
    );

    if (!buscador) return;

    for (const jugador of jugadores) {
        if (
            jugador.rol !== "escondido" ||
            jugador.atrapado
        ) {
            continue;
        }

        const distancia = Math.hypot(
            buscador.x - jugador.x,
            buscador.y - jugador.y
        );

        // Si el buscador se acerca lo suficiente, lo atrapa.
        if (distancia < 38) {
            jugador.atrapado = true;
        }
    }

    if (todosAtrapados(sala)) {
        terminarPartida(
            codigo,
            "¡Ganó el buscador!",
            "Encontró a todos los jugadores escondidos."
        );
    }
}

function agregarJugador(socket, codigo, nombre, callback) {
    const sala = salas.get(codigo);

    if (!sala) {
        callback({
            ok: false,
            mensaje: "Esa sala no existe."
        });
        return;
    }

    if (sala.fase !== "esperando") {
        callback({
            ok: false,
            mensaje: "La partida ya comenzó. Creá otra sala."
        });
        return;
    }

    if (sala.jugadores.size >= MAX_JUGADORES) {
        callback({
            ok: false,
            mensaje: "La sala está llena. Solo pueden jugar 4 personas."
        });
        return;
    }

    const nombreSeguro = String(nombre || "Jugador")
        .trim()
        .slice(0, 16) || "Jugador";

    const jugador = {
        id: socket.id,
        nombre: nombreSeguro,
        x: 150,
        y: 150,
        rol: "esperando",
        atrapado: false
    };

    sala.jugadores.set(socket.id, jugador);
    socket.join(codigo);
    socket.data.codigoSala = codigo;

    callback({
        ok: true,
        codigo
    });

    enviarEstado(codigo);

    // La partida empieza al conectarse los cuatro jugadores.
    if (sala.jugadores.size === MAX_JUGADORES) {
        iniciarPartida(codigo);
    }
}

io.on("connection", socket => {
    console.log("Jugador conectado:", socket.id);

    socket.on("crearSala", (datos, callback) => {
        const nombre = datos?.nombre;

        if (!String(nombre || "").trim()) {
            callback({
                ok: false,
                mensaje: "Escribí tu nombre."
            });
            return;
        }

        let codigo = generarCodigo();

        while (salas.has(codigo)) {
            codigo = generarCodigo();
        }

        salas.set(codigo, {
            jugadores: new Map(),
            fase: "esperando",
            tiempoRestante: 0,
            musica: null,
            intervalo: null
        });

        agregarJugador(socket, codigo, nombre, callback);
    });

    socket.on("unirseSala", (datos, callback) => {
        const nombre = datos?.nombre;
        const codigo = String(datos?.codigo || "")
            .trim()
            .toUpperCase();

        if (!String(nombre || "").trim()) {
            callback({
                ok: false,
                mensaje: "Escribí tu nombre."
            });
            return;
        }

        agregarJugador(socket, codigo, nombre, callback);
    });

    socket.on("moverJugador", datos => {
        const codigo = socket.data.codigoSala;
        const sala = salas.get(codigo);

        if (!sala) return;

        if (
            sala.fase !== "contando" &&
            sala.fase !== "buscando"
        ) {
            return;
        }

        const jugador = sala.jugadores.get(socket.id);
        if (!jugador || jugador.atrapado) return;

        const x = Number(datos?.x);
        const y = Number(datos?.y);

        if (!Number.isFinite(x) || !Number.isFinite(y)) return;

        // Impedir que el jugador salga de los límites del mapa.
        jugador.x = Math.max(
            16,
            Math.min(ANCHO_MAPA - 16, x)
        );

        jugador.y = Math.max(
            16,
            Math.min(ALTO_MAPA - 16, y)
        );

        if (sala.fase === "buscando") {
            comprobarCaptura(codigo);
        }

        enviarEstado(codigo);
    });

    socket.on("disconnect", () => {
        const codigo = socket.data.codigoSala;
        if (!codigo) return;

        const sala = salas.get(codigo);
        if (!sala) return;

        sala.jugadores.delete(socket.id);

        if (sala.jugadores.size === 0) {
            if (sala.intervalo) {
                clearInterval(sala.intervalo);
            }

            salas.delete(codigo);
            return;
        }

        // Si alguien se desconecta durante la partida, se termina
        // para que los demás no queden atrapados en una ronda incompleta.
        if (
            sala.fase === "contando" ||
            sala.fase === "buscando"
        ) {
            terminarPartida(
                codigo,
                "Partida cancelada",
                "Un jugador se desconectó."
            );
        } else {
            enviarEstado(codigo);
        }

        console.log("Jugador desconectado:", socket.id);
    });
});

servidor.listen(PORT, () => {
    console.log(`Servidor iniciado en http://localhost:${PORT}`);
});
