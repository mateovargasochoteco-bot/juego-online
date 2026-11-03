const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const salas = new Map();

const MAX_JUGADORES = 4;
const TIEMPO_CUENTA = 15;
const TIEMPO_BUSQUEDA = 100;
const DISTANCIA_ATRAPAR = 45;

/* =====================================
   CODIGO DE SALA
===================================== */

function generarCodigo() {
    const caracteres = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let codigo = "";

    for (let i = 0; i < 5; i++) {
        codigo += caracteres.charAt(
            Math.floor(Math.random() * caracteres.length)
        );
    }

    return codigo;
}

/* =====================================
   CREAR ESTADO
===================================== */

function crearEstadoSala() {
    return {
        jugadores: new Map(),
        fase: "esperando",
        buscadorId: null,
        tiempo: 0,
        intervalo: null,
        indiceMusica: Math.floor(Math.random() * 4)
    };
}

/* =====================================
   POSICIONES INICIALES
===================================== */

function posicionesIniciales(cantidad) {
    const posiciones = [
        { x: 1050, y: 675 },
        { x: 300, y: 300 },
        { x: 1800, y: 300 },
        { x: 1050, y: 1050 }
    ];

    return posiciones[cantidad % posiciones.length];
}

/* =====================================
   ENVIAR ESTADO
===================================== */

function enviarEstado(codigo) {
    const sala = salas.get(codigo);

    if (!sala) return;

    for (const jugador of sala.jugadores.values()) {
        const visibles = [];

        for (const otro of sala.jugadores.values()) {
            const esYo = otro.id === jugador.id;
            const esBuscador = otro.id === sala.buscadorId;
            const estaAtrapado = otro.atrapado === true;

            let visible = true;

            /*
                DURANTE LA CUENTA:

                El buscador no recibe la ubicación
                de los escondidos.
            */

            if (
                sala.fase === "cuenta" &&
                jugador.id === sala.buscadorId &&
                !esBuscador
            ) {
                visible = false;
            }

            /*
                DURANTE LA BUSQUEDA:

                El buscador no recibe la ubicación
                de los escondidos que todavía no atrapó.
            */

            if (
                sala.fase === "busqueda" &&
                jugador.id === sala.buscadorId &&
                !esBuscador &&
                !estaAtrapado
            ) {
                visible = false;
            }

            /*
                LOS ESCONDIDOS:

                Reciben la ubicación del buscador.
                El cliente lo oculta solamente del minimapa.
            */

            if (visible || esYo) {
                visibles.push({
                    id: otro.id,
                    x: otro.x,
                    y: otro.y,

                    rol: otro.id === sala.buscadorId
                        ? "buscador"
                        : "escondido",

                    atrapado: estaAtrapado,
                    visible
                });
            }
        }

        io.to(jugador.id).emit(
            "actualizarJugadores",
            visibles
        );

        io.to(jugador.id).emit("estadoPartida", {
            fase: sala.fase,
            tiempo: sala.tiempo,
            jugadores: sala.jugadores.size,

            miRol: jugador.id === sala.buscadorId
                ? "buscador"
                : "escondido"
        });
    }
}

/* =====================================
   TEMPORIZADOR
===================================== */

function detenerTemporizador(sala) {
    if (sala.intervalo) {
        clearInterval(sala.intervalo);
        sala.intervalo = null;
    }
}

/* =====================================
   INICIAR PARTIDA
===================================== */

function iniciarPartida(codigo) {
    const sala = salas.get(codigo);

    if (!sala) return;

    // Necesitamos los 4 jugadores.
    if (sala.jugadores.size !== MAX_JUGADORES) return;

    if (sala.fase !== "esperando") return;

    const lista = Array.from(sala.jugadores.values());

    // Elegir un buscador al azar.
    const elegido =
        lista[Math.floor(Math.random() * lista.length)];

    sala.buscadorId = elegido.id;

    sala.fase = "cuenta";
    sala.tiempo = TIEMPO_CUENTA;

    for (const jugador of lista) {
        jugador.atrapado = false;
    }

    // Elegir música aleatoria.
    sala.indiceMusica = Math.floor(Math.random() * 4);

    io.to(codigo).emit("musicaPartida", {
        indice: sala.indiceMusica
    });

    enviarEstado(codigo);

    detenerTemporizador(sala);

    sala.intervalo = setInterval(() => {
        if (!salas.has(codigo)) {
            detenerTemporizador(sala);
            return;
        }

        sala.tiempo--;

        if (sala.tiempo <= 0) {

            if (sala.fase === "cuenta") {
                // Termina la cuenta y comienza la búsqueda.
                sala.fase = "busqueda";
                sala.tiempo = TIEMPO_BUSQUEDA;
            }

            else if (sala.fase === "busqueda") {
                // Se terminaron los 100 segundos.
                terminarPartida(codigo, "escondidos");
                return;
            }
        }

        enviarEstado(codigo);

    }, 1000);
}

/* =====================================
   COMPROBAR ATRAPADOS
===================================== */

function comprobarAtrapados(codigo) {
    const sala = salas.get(codigo);

    if (!sala || sala.fase !== "busqueda") return;

    const buscador = sala.jugadores.get(sala.buscadorId);

    if (!buscador) return;

    for (const jugador of sala.jugadores.values()) {

        if (jugador.id === sala.buscadorId) continue;

        if (jugador.atrapado) continue;

        const dx = buscador.x - jugador.x;
        const dy = buscador.y - jugador.y;

        const distancia = Math.sqrt(
            dx * dx + dy * dy
        );

        if (distancia <= DISTANCIA_ATRAPAR) {
            jugador.atrapado = true;
        }
    }

    const vivos = Array.from(sala.jugadores.values())
        .filter(jugador =>
            jugador.id !== sala.buscadorId &&
            !jugador.atrapado
        );

    // Si no queda ningún escondido, gana el buscador.
    if (vivos.length === 0) {
        terminarPartida(codigo, "buscador");
    }
}

/* =====================================
   TERMINAR PARTIDA
===================================== */

function terminarPartida(codigo, ganador) {
    const sala = salas.get(codigo);

    if (!sala) return;

    detenerTemporizador(sala);

    sala.fase = "fin";
    sala.tiempo = 0;

    const mensajeFinal =
        ganador === "buscador"
            ? "El buscador encontró a todos."
            : "Terminó el tiempo y todavía quedaban escondidos.";

    for (const jugador of sala.jugadores.values()) {
        io.to(jugador.id).emit("estadoPartida", {
            fase: "fin",
            tiempo: 0,
            jugadores: sala.jugadores.size,

            miRol: jugador.id === sala.buscadorId
                ? "buscador"
                : "escondido",

            ganador,
            mensajeFinal
        });
    }

    enviarEstado(codigo);
}

/* =====================================
   CONEXIONES
===================================== */

io.on("connection", socket => {

    console.log("Jugador conectado:", socket.id);

    /* CREAR SALA */

    socket.on("crearSala", () => {
        let codigo;

        do {
            codigo = generarCodigo();
        } while (salas.has(codigo));

        const sala = crearEstadoSala();

        salas.set(codigo, sala);

        socket.join(codigo);
        socket.sala = codigo;

        const posicion = posicionesIniciales(0);

        sala.jugadores.set(socket.id, {
            id: socket.id,
            x: posicion.x,
            y: posicion.y,
            atrapado: false
        });

        socket.emit("salaCreada", {
            codigo,
            jugadores: sala.jugadores.size
        });

        enviarEstado(codigo);

        console.log(`Sala ${codigo} creada`);
    });

    /* UNIRSE A SALA */

    socket.on("unirseSala", codigoRecibido => {
        const codigo = String(codigoRecibido)
            .trim()
            .toUpperCase();

        const sala = salas.get(codigo);

        if (!sala) {
            socket.emit(
                "errorSala",
                "La sala no existe."
            );

            return;
        }

        if (sala.jugadores.size >= MAX_JUGADORES) {
            socket.emit(
                "errorSala",
                "La sala está llena."
            );

            return;
        }

        if (sala.fase !== "esperando") {
            socket.emit(
                "errorSala",
                "La partida ya comenzó. Esperá la próxima partida."
            );

            return;
        }

        socket.join(codigo);
        socket.sala = codigo;

        const numeroJugador = sala.jugadores.size;

        const posicion = posicionesIniciales(numeroJugador);

        sala.jugadores.set(socket.id, {
            id: socket.id,
            x: posicion.x,
            y: posicion.y,
            atrapado: false
        });

        socket.emit("salaUnida", {
            codigo,
            jugadores: sala.jugadores.size
        });

        enviarEstado(codigo);

        console.log(
            `Jugador ${socket.id} se unió a ${codigo}`
        );

        // Cuando entra el cuarto jugador, empieza la partida.
        if (sala.jugadores.size === MAX_JUGADORES) {
            setTimeout(() => {
                iniciarPartida(codigo);
            }, 800);
        }
    });

    /* =====================================
       MOVIMIENTO
    ===================================== */

    socket.on("moverJugador", posicion => {
        if (!socket.sala) return;

        const sala = salas.get(socket.sala);

        if (!sala) return;

        const jugador = sala.jugadores.get(socket.id);

        if (!jugador) return;

        /*
            IMPORTANTE:

            El buscador no puede moverse mientras cuenta.
            El servidor también bloquea el movimiento,
            no solamente el navegador.
        */

        if (
            sala.fase === "cuenta" &&
            socket.id === sala.buscadorId
        ) {
            return;
        }

        // Solo se puede mover durante la cuenta o búsqueda.
        if (
            sala.fase !== "cuenta" &&
            sala.fase !== "busqueda"
        ) {
            return;
        }

        const x = Number(posicion?.x);
        const y = Number(posicion?.y);

        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y)
        ) {
            return;
        }

        jugador.x = Math.max(
            27,
            Math.min(2073, x)
        );

        jugador.y = Math.max(
            27,
            Math.min(1323, y)
        );

        comprobarAtrapados(socket.sala);

        enviarEstado(socket.sala);
    });

    /* =====================================
       DESCONECTAR JUGADOR
    ===================================== */

    socket.on("disconnect", () => {
        if (!socket.sala) return;

        const codigo = socket.sala;

        const sala = salas.get(codigo);

        if (!sala) return;

        sala.jugadores.delete(socket.id);

        // Si no queda nadie, eliminar sala.
        if (sala.jugadores.size === 0) {
            detenerTemporizador(sala);

            salas.delete(codigo);

            console.log(`Sala ${codigo} eliminada`);

            return;
        }

        /*
            Si se desconecta el buscador,
            reiniciamos la sala.
        */

        if (
            socket.id === sala.buscadorId &&
            sala.fase !== "esperando" &&
            sala.fase !== "fin"
        ) {
            detenerTemporizador(sala);

            sala.fase = "esperando";
            sala.buscadorId = null;
            sala.tiempo = 0;

            for (const jugador of sala.jugadores.values()) {
                jugador.atrapado = false;
            }
        }

        enviarEstado(codigo);

        console.log(
            `Jugador ${socket.id} desconectado de ${codigo}`
        );
    });
});

/* =====================================
   INICIAR SERVIDOR
===================================== */

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log(
        `Servidor iniciado en http://localhost:${PORT}`
    );
});
