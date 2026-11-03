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

/* =========================
   CÓDIGO DE SALA
========================= */

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

/* =========================
   CREAR ESTADO DE SALA
========================= */

function crearEstadoSala() {
    return {
        jugadores: new Map(),
        fase: "esperando",
        buscadorId: null,
        tiempo: 0,
        intervalo: null,
        indiceMusica: 0
    };
}

/* =========================
   POSICIONES INICIALES
========================= */

function posicionesIniciales(cantidad) {
    // Coordenadas del mapa ampliado original de 2100 x 1350.
    const posiciones = [
        { x: 1050, y: 675 },
        { x: 300, y: 300 },
        { x: 1800, y: 300 },
        { x: 1050, y: 1050 }
    ];

    return posiciones[cantidad % posiciones.length];
}

/* =========================
   ENVIAR ESTADO
========================= */

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
             * Durante la cuenta, el buscador
             * no recibe las posiciones de los escondidos.
             */
            if (
                sala.fase === "cuenta" &&
                jugador.id === sala.buscadorId &&
                !esBuscador
            ) {
                visible = false;
            }

            /*
             * Durante la búsqueda, el buscador
             * tampoco recibe la posición de los
             * escondidos que todavía no atrapó.
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
             * Los escondidos reciben la posición
             * del buscador para poder verlo.
             */
            if (visible || esYo) {
                visibles.push({
                    id: otro.id,
                    x: otro.x,
                    y: otro.y,

                    rol: esBuscador
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

        io.to(jugador.id).emit(
            "estadoPartida",
            {
                fase: sala.fase,
                tiempo: sala.tiempo,
                jugadores: sala.jugadores.size,

                miRol: jugador.id === sala.buscadorId
                    ? "buscador"
                    : "escondido"
            }
        );
    }
}

/* =========================
   DETENER TEMPORIZADOR
========================= */

function detenerTemporizador(sala) {
    if (sala.intervalo) {
        clearInterval(sala.intervalo);
        sala.intervalo = null;
    }
}

/* =========================
   INICIAR PARTIDA
========================= */

function iniciarPartida(codigo) {
    const sala = salas.get(codigo);

    if (!sala) return;

    // La partida necesita exactamente 4 jugadores.
    if (sala.jugadores.size !== MAX_JUGADORES) return;

    if (sala.fase !== "esperando") return;

    const lista = Array.from(
        sala.jugadores.values()
    );

    // Elegir buscador al azar.
    const elegido =
        lista[Math.floor(Math.random() * lista.length)];

    sala.buscadorId = elegido.id;

    sala.fase = "cuenta";
    sala.tiempo = TIEMPO_CUENTA;

    // Reiniciar estado de todos los jugadores.
    for (const jugador of lista) {
        jugador.atrapado = false;
    }

    // Elegir una canción aleatoria.
    sala.indiceMusica = Math.floor(
        Math.random() * 4
    );

    io.to(codigo).emit(
        "musicaPartida",
        {
            indice: sala.indiceMusica
        }
    );

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

        // Terminó la cuenta.
        if (
            sala.fase === "cuenta" &&
            sala.tiempo <= 0
        ) {
            sala.fase = "busqueda";
            sala.tiempo = TIEMPO_BUSQUEDA;
        }

        // Terminó el tiempo de búsqueda.
        else if (
            sala.fase === "busqueda" &&
            sala.tiempo <= 0
        ) {
            terminarPartida(codigo, "escondidos");
            return;
        }

        enviarEstado(codigo);

    }, 1000);
}

/* =========================
   ATRAPAR ESCONDIDOS
========================= */

function comprobarAtrapados(codigo) {
    const sala = salas.get(codigo);

    if (!sala || sala.fase !== "busqueda") {
        return;
    }

    const buscador = sala.jugadores.get(
        sala.buscadorId
    );

    if (!buscador) return;

    for (const jugador of sala.jugadores.values()) {
        if (jugador.id === sala.buscadorId) {
            continue;
        }

        if (jugador.atrapado) {
            continue;
        }

        const dx = buscador.x - jugador.x;
        const dy = buscador.y - jugador.y;

        const distancia = Math.sqrt(
            dx * dx + dy * dy
        );

        if (distancia <= DISTANCIA_ATRAPAR) {
            jugador.atrapado = true;

            io.to(jugador.id).emit(
                "jugadorAtrapado"
            );
        }
    }

    // Comprobar si todavía queda algún escondido.
    const escondidosRestantes =
        Array.from(sala.jugadores.values()).filter(
            jugador =>
                jugador.id !== sala.buscadorId &&
                !jugador.atrapado
        );

    if (escondidosRestantes.length === 0) {
        terminarPartida(codigo, "buscador");
    }
}

/* =========================
   TERMINAR PARTIDA
========================= */

function terminarPartida(codigo, ganador) {
    const sala = salas.get(codigo);

    if (!sala || sala.fase === "fin") return;

    detenerTemporizador(sala);

    sala.fase = "fin";
    sala.tiempo = 0;

    const mensajeFinal =
        ganador === "buscador"
            ? "El buscador encontró a todos."
            : "Terminó el tiempo y todavía quedaban escondidos.";

    for (const jugador of sala.jugadores.values()) {
        io.to(jugador.id).emit(
            "estadoPartida",
            {
                fase: "fin",
                tiempo: 0,
                jugadores: sala.jugadores.size,

                miRol: jugador.id === sala.buscadorId
                    ? "buscador"
                    : "escondido",

                ganador,
                mensajeFinal
            }
        );
    }

    enviarEstado(codigo);
}

/* =========================
   CONEXIONES
========================= */

io.on("connection", socket => {
    console.log(
        "Jugador conectado:",
        socket.id
    );

    /* =========================
       CREAR SALA
    ========================= */

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

        socket.emit(
            "salaCreada",
            {
                codigo,
                jugadores: sala.jugadores.size
            }
        );

        enviarEstado(codigo);

        console.log(
            `Sala ${codigo} creada`
        );
    });

    /* =========================
       UNIRSE A SALA
    ========================= */

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
                "La partida ya comenzó."
            );
            return;
        }

        socket.join(codigo);
        socket.sala = codigo;

        const numeroJugador = sala.jugadores.size;

        const posicion = posicionesIniciales(
            numeroJugador
        );

        sala.jugadores.set(socket.id, {
            id: socket.id,
            x: posicion.x,
            y: posicion.y,
            atrapado: false
        });

        socket.emit(
            "salaUnida",
            {
                codigo,
                jugadores: sala.jugadores.size
            }
        );

        enviarEstado(codigo);

        console.log(
            `Jugador ${socket.id} se unió a ${codigo}`
        );

        // Comenzar solamente cuando estén los cuatro.
        if (sala.jugadores.size === MAX_JUGADORES) {
            setTimeout(() => {
                iniciarPartida(codigo);
            }, 800);
        }
    });

    /* =========================
       MOVIMIENTO
    ========================= */

    socket.on("moverJugador", posicion => {
        if (!socket.sala) return;

        const sala = salas.get(socket.sala);
        if (!sala) return;

        const jugador = sala.jugadores.get(socket.id);
        if (!jugador) return;

        // El buscador no se mueve durante la cuenta.
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

        // Los jugadores atrapados no pueden seguir moviéndose.
        if (jugador.atrapado) return;

        const x = Number(posicion?.x);
        const y = Number(posicion?.y);

        if (
            !Number.isFinite(x) ||
            !Number.isFinite(y)
        ) {
            return;
        }

        // Límites del mapa original ampliado.
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

    /* =========================
       DESCONECTAR
    ========================= */

    socket.on("disconnect", () => {
        if (!socket.sala) return;

        const codigo = socket.sala;
        const sala = salas.get(codigo);

        if (!sala) return;

        const eraBuscador =
            socket.id === sala.buscadorId;

        sala.jugadores.delete(socket.id);

        if (sala.jugadores.size === 0) {
            detenerTemporizador(sala);
            salas.delete(codigo);

            console.log(
                `Sala ${codigo} eliminada`
            );

            return;
        }

        // Si se desconecta el buscador,
        // la partida vuelve a la espera.
        if (
            eraBuscador &&
            sala.fase !== "esperando"
        ) {
            detenerTemporizador(sala);

            sala.fase = "esperando";
            sala.buscadorId = null;
            sala.tiempo = 0;

            for (const jugador of sala.jugadores.values()) {
                jugador.atrapado = false;
            }
        }

        // Si se desconecta alguien durante la partida,
        // se cancela y se espera a completar otra sala.
        else if (
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

/* =========================
   INICIAR SERVIDOR
========================= */

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log(
        `Servidor iniciado en http://localhost:${PORT}`
    );
});
