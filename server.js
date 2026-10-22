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

// Tamaño del mapa ampliado.
const MAPA_ANCHO = 2100;
const MAPA_ALTO = 1350;

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

// Posiciones iniciales distribuidas por el mapa.
function posicionesIniciales(cantidad) {
    const posiciones = [
        { x: 1050, y: 675 },
        { x: 300, y: 300 },
        { x: 1800, y: 300 },
        { x: 1050, y: 1050 }
    ];

    return posiciones[cantidad % posiciones.length];
}

function detenerTemporizador(sala) {
    if (sala.intervalo) {
        clearInterval(sala.intervalo);
        sala.intervalo = null;
    }
}

// Envía a cada jugador solamente las posiciones que puede conocer.
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

            // El buscador no ve a los escondidos mientras cuenta.
            if (
                sala.fase === "cuenta" &&
                esYo &&
                esBuscador
            ) {
                // La posición del propio buscador se mantiene visible.
            }

            if (
                sala.fase === "cuenta" &&
                jugador.id === sala.buscadorId &&
                !esBuscador
            ) {
                visible = false;
            }

            // Durante la búsqueda no se envían al buscador
            // las posiciones de los escondidos que siguen libres.
            if (
                sala.fase === "busqueda" &&
                jugador.id === sala.buscadorId &&
                !esBuscador &&
                !estaAtrapado
            ) {
                visible = false;
            }

            // Los escondidos pueden ver a los demás jugadores.
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

        // Mantiene actualizada la cantidad de jugadores.
        io.to(jugador.id).emit("estadoSala", {
            cantidad: sala.jugadores.size,
            completa: sala.jugadores.size === MAX_JUGADORES
        });
    }
}

// Inicia una partida y elige al buscador al azar.
function iniciarPartida(codigo) {
    const sala = salas.get(codigo);

    if (!sala || sala.jugadores.size < 2) return;
    if (sala.fase !== "esperando") return;

    const lista = Array.from(sala.jugadores.values());

    const elegido =
        lista[Math.floor(Math.random() * lista.length)];

    sala.buscadorId = elegido.id;
    sala.fase = "cuenta";
    sala.tiempo = TIEMPO_CUENTA;

    for (const jugador of lista) {
        jugador.atrapado = false;
    }

    // Todos reciben el mismo índice de música.
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

        if (
            sala.fase !== "cuenta" &&
            sala.fase !== "busqueda"
        ) {
            detenerTemporizador(sala);
            return;
        }

        sala.tiempo--;

        if (sala.tiempo <= 0) {
            if (sala.fase === "cuenta") {
                // Se termina la cuenta y comienza la búsqueda.
                sala.fase = "busqueda";
                sala.tiempo = TIEMPO_BUSQUEDA;
            } else if (sala.fase === "busqueda") {
                // Se agotaron los 100 segundos:
                // ganan los escondidos que sigan libres.
                terminarPartida(codigo, "escondidos");
                return;
            }
        }

        enviarEstado(codigo);
    }, 1000);
}

// Comprueba si el buscador atrapó a todos.
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
        const distancia = Math.sqrt(dx * dx + dy * dy);

        if (distancia <= DISTANCIA_ATRAPAR) {
            jugador.atrapado = true;
        }
    }

    const escondidosRestantes =
        Array.from(sala.jugadores.values()).filter(jugador =>
            jugador.id !== sala.buscadorId &&
            !jugador.atrapado
        );

    if (escondidosRestantes.length === 0) {
        terminarPartida(codigo, "buscador");
        return;
    }

    enviarEstado(codigo);
}

// Termina la partida y anuncia el ganador a todos.
function terminarPartida(codigo, ganador) {
    const sala = salas.get(codigo);
    if (!sala || sala.fase === "fin") return;

    detenerTemporizador(sala);

    sala.fase = "fin";
    sala.tiempo = 0;

    const mensajeFinal =
        ganador === "buscador"
            ? "¡El buscador encontró a todos y ganó!"
            : "¡Se acabó el tiempo! ¡Ganaron los escondidos!";

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

io.on("connection", socket => {
    console.log("Jugador conectado:", socket.id);

    // Crear una sala.
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

        console.log("Sala creada:", codigo);
    });

    // Unirse a una sala existente.
    socket.on("unirseSala", codigoRecibido => {
        const codigo = String(codigoRecibido)
            .trim()
            .toUpperCase();

        const sala = salas.get(codigo);

        if (!sala) {
            socket.emit("errorSala", "La sala no existe.");
            return;
        }

        if (sala.jugadores.size >= MAX_JUGADORES) {
            socket.emit("errorSala", "La sala está llena.");
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

        console.log("Jugador unido a la sala:", codigo);

        if (sala.jugadores.size >= 2) {
            setTimeout(() => iniciarPartida(codigo), 800);
        }
    });

    // Recibir y validar el movimiento.
    socket.on("moverJugador", posicion => {
        if (!socket.sala) return;

        const sala = salas.get(socket.sala);
        if (!sala) return;

        const jugador = sala.jugadores.get(socket.id);
        if (!jugador) return;

        // El buscador no puede moverse mientras cuenta.
        if (
            sala.fase === "cuenta" &&
            socket.id === sala.buscadorId
        ) {
            return;
        }

        if (
            sala.fase !== "cuenta" &&
            sala.fase !== "busqueda"
        ) {
            return;
        }

        // Los jugadores atrapados ya no pueden escapar.
        if (jugador.atrapado) return;

        const x = Number(posicion?.x);
        const y = Number(posicion?.y);

        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return;
        }

        jugador.x = Math.max(
            27,
            Math.min(MAPA_ANCHO - 27, x)
        );

        jugador.y = Math.max(
            27,
            Math.min(MAPA_ALTO - 27, y)
        );

        comprobarAtrapados(socket.sala);
        enviarEstado(socket.sala);
    });

    // Desconexión de un jugador.
    socket.on("disconnect", () => {
        if (!socket.sala) return;

        const codigo = socket.sala;
        const sala = salas.get(codigo);

        if (!sala) return;

        sala.jugadores.delete(socket.id);

        if (sala.jugadores.size === 0) {
            detenerTemporizador(sala);
            salas.delete(codigo);

            console.log("Sala eliminada:", codigo);
            return;
        }

        // Si se desconecta el buscador, se reinicia la sala.
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

        console.log("Jugador desconectado:", socket.id);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log(
        `Servidor iniciado en http://localhost:${PORT}`
    );
});
