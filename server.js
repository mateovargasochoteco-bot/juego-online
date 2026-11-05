const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const servidor = http.createServer(app);
const io = new Server(servidor);

app.use(express.static(path.join(__dirname, "public")));

const salas = new Map();

const ANCHO_MAPA = 1450;
const ALTO_MAPA = 1200;
const MAX_JUGADORES = 4;

function generarCodigo() {
    const caracteres = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let codigo = "";

    for (let i = 0; i < 5; i++) {
        codigo += caracteres[Math.floor(Math.random() * caracteres.length)];
    }

    return codigo;
}

// --------------------------------------------------
// ZONAS POR LAS QUE SE PUEDE CAMINAR
// --------------------------------------------------

function crearZonasTransitables() {
    const zonas = [];

    // Habitaciones
    for (let fila = 0; fila < 3; fila++) {
        for (let columna = 0; columna < 3; columna++) {
            const x = 50 + columna * 500;
            const y = 50 + fila * 400;

            zonas.push({
                x: x + 13,
                y: y + 13,
                ancho: 324,
                alto: 274
            });
        }
    }

    // Pasillos horizontales
    for (let fila = 0; fila < 3; fila++) {
        const y = 155 + fila * 400;

        for (let columna = 0; columna < 2; columna++) {
            const x = 400 + columna * 500;

            zonas.push({
                x,
                y,
                ancho: 150,
                alto: 90
            });
        }
    }

    // Pasillos verticales
    for (let columna = 0; columna < 3; columna++) {
        const x = 180 + columna * 500;

        for (let fila = 0; fila < 2; fila++) {
            const y = 350 + fila * 400;

            zonas.push({
                x,
                y,
                ancho: 90,
                alto: 100
            });
        }
    }

    // Conexiones horizontales entre habitaciones y pasillos
    for (let fila = 0; fila < 3; fila++) {
        const centroY = 200 + fila * 400;

        for (let columna = 0; columna < 2; columna++) {
            const izquierda = 50 + columna * 500;

            zonas.push({
                x: izquierda + 337,
                y: centroY - 24,
                ancho: 26,
                alto: 48
            });

            zonas.push({
                x: izquierda + 487,
                y: centroY - 24,
                ancho: 26,
                alto: 48
            });
        }
    }

    // Conexiones verticales entre habitaciones y pasillos
    for (let columna = 0; columna < 3; columna++) {
        const izquierda = 50 + columna * 500;
        const centroX = izquierda + 175;

        for (let fila = 0; fila < 2; fila++) {
            const arriba = 50 + fila * 400;

            zonas.push({
                x: centroX - 24,
                y: arriba + 287,
                ancho: 48,
                alto: 26
            });

            zonas.push({
                x: centroX - 24,
                y: arriba + 387,
                ancho: 48,
                alto: 26
            });
        }
    }

    return zonas;
}

const zonasTransitables = crearZonasTransitables();

function dentroDeZona(x, y) {
    return zonasTransitables.some(zona =>
        x >= zona.x &&
        x <= zona.x + zona.ancho &&
        y >= zona.y &&
        y <= zona.y + zona.alto
    );
}

// --------------------------------------------------
// CREAR SALA
// --------------------------------------------------

function crearSala(socket) {
    let codigo = generarCodigo();

    while (salas.has(codigo)) {
        codigo = generarCodigo();
    }

    const sala = {
        jugadores: new Map(),
        fase: "esperando",
        tiempo: 200,
        cuenta: 15,
        buscador: null,
        estrellas: [
            { id: 1, x: 220, y: 200, recogida: false },
            { id: 2, x: 720, y: 600, recogida: false },
            { id: 3, x: 1220, y: 1000, recogida: false }
        ],
        intervalo: null
    };

    salas.set(codigo, sala);

    socket.join(codigo);
    socket.sala = codigo;

    sala.jugadores.set(socket.id, {
        id: socket.id,
        x: 200,
        y: 200,
        rol: null,
        atrapado: false
    });

    socket.emit("salaCreada", codigo);

    return codigo;
}

// --------------------------------------------------
// ESTADO DE LA SALA
// --------------------------------------------------

function enviarEstado(codigo) {
    const sala = salas.get(codigo);

    if (!sala) return;

    io.to(codigo).emit("estadoSala", {
        jugadores: Array.from(sala.jugadores.values()),
        fase: sala.fase,
        tiempo: sala.tiempo,
        cuenta: sala.cuenta,
        buscador: sala.buscador,
        estrellas: sala.estrellas
    });
}

// --------------------------------------------------
// INICIAR PARTIDA
// --------------------------------------------------

function iniciarPartida(codigo) {
    const sala = salas.get(codigo);

    if (!sala || sala.jugadores.size !== MAX_JUGADORES) return;

    const jugadores = Array.from(sala.jugadores.values());
    const indiceBuscador = Math.floor(Math.random() * jugadores.length);

    sala.buscador = jugadores[indiceBuscador].id;

    jugadores.forEach(jugador => {
        jugador.rol = jugador.id === sala.buscador
            ? "buscador"
            : "escondido";

        jugador.atrapado = false;
    });

    sala.fase = "cuenta";
    sala.cuenta = 15;
    sala.tiempo = 200;

    sala.estrellas.forEach(estrella => {
        estrella.recogida = false;
    });

    enviarEstado(codigo);

    clearInterval(sala.intervalo);

    sala.intervalo = setInterval(() => {
        if (sala.fase === "cuenta") {
            sala.cuenta--;

            if (sala.cuenta <= 0) {
                sala.fase = "jugando";
                enviarEstado(codigo);
            }

            enviarEstado(codigo);
            return;
        }

        if (sala.fase === "jugando") {
            sala.tiempo--;

            if (sala.tiempo <= 0) {
                terminarPartida(codigo, "¡Ganaron los escondidos!");
                return;
            }

            enviarEstado(codigo);
        }
    }, 1000);
}

// --------------------------------------------------
// TERMINAR PARTIDA
// --------------------------------------------------

function terminarPartida(codigo, mensaje) {
    const sala = salas.get(codigo);

    if (!sala) return;

    sala.fase = "terminada";

    clearInterval(sala.intervalo);

    io.to(codigo).emit("finPartida", mensaje);
    enviarEstado(codigo);
}

// --------------------------------------------------
// CONEXIONES
// --------------------------------------------------

io.on("connection", socket => {
    console.log("Jugador conectado:", socket.id);

    socket.on("crearSala", () => {
        crearSala(socket);
    });

    socket.on("unirseSala", codigo => {
        codigo = String(codigo).toUpperCase().trim();

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
            socket.emit("errorSala", "La partida ya comenzó.");
            return;
        }

        socket.join(codigo);
        socket.sala = codigo;

        sala.jugadores.set(socket.id, {
            id: socket.id,
            x: 200 + Math.random() * 80,
            y: 200 + Math.random() * 80,
            rol: null,
            atrapado: false
        });

        socket.emit("unidoSala", codigo);

        enviarEstado(codigo);

        if (sala.jugadores.size === MAX_JUGADORES) {
            iniciarPartida(codigo);
        }
    });

    // --------------------------------------------------
    // MOVIMIENTO
    // --------------------------------------------------

    socket.on("moverJugador", datos => {
        const codigo = socket.sala;
        const sala = salas.get(codigo);

        if (!sala || !datos) return;

        const jugador = sala.jugadores.get(socket.id);

        if (!jugador || jugador.atrapado) return;

        if (sala.fase === "esperando") return;

        if (
            sala.fase === "cuenta" &&
            jugador.rol === "buscador"
        ) {
            return;
        }

        const nuevoX = Number(datos.x);
        const nuevoY = Number(datos.y);

        if (!Number.isFinite(nuevoX) || !Number.isFinite(nuevoY)) {
            return;
        }

        const distancia = Math.hypot(
            nuevoX - jugador.x,
            nuevoY - jugador.y
        );

        // Evita saltos de posición demasiado grandes
        if (distancia > 15) return;

        // Las paredes bloquean el movimiento
        if (!dentroDeZona(nuevoX, nuevoY)) return;

        jugador.x = nuevoX;
        jugador.y = nuevoY;

        // Recoger estrellas
        if (jugador.rol === "escondido") {
            sala.estrellas.forEach(estrella => {
                if (estrella.recogida) return;

                const distanciaEstrella = Math.hypot(
                    jugador.x - estrella.x,
                    jugador.y - estrella.y
                );

                if (distanciaEstrella < 25) {
                    estrella.recogida = true;
                }
            });

            if (sala.estrellas.every(e => e.recogida)) {
                terminarPartida(
                    codigo,
                    "¡Los escondidos encontraron todas las estrellas!"
                );
                return;
            }
        }

        enviarEstado(codigo);
    });

    // --------------------------------------------------
    // ATRAPAR JUGADOR
    // --------------------------------------------------

    socket.on("atraparJugador", idObjetivo => {
        const codigo = socket.sala;
        const sala = salas.get(codigo);

        if (!sala || sala.fase !== "jugando") return;

        const buscador = sala.jugadores.get(socket.id);
        const objetivo = sala.jugadores.get(idObjetivo);

        if (!buscador || !objetivo) return;

        if (buscador.rol !== "buscador") return;
        if (objetivo.rol !== "escondido") return;
        if (objetivo.atrapado) return;

        const distancia = Math.hypot(
            buscador.x - objetivo.x,
            buscador.y - objetivo.y
        );

        if (distancia > 45) return;

        objetivo.atrapado = true;

        enviarEstado(codigo);

        const escondidos = Array.from(sala.jugadores.values())
            .filter(j => j.rol === "escondido");

        if (escondidos.every(j => j.atrapado)) {
            terminarPartida(codigo, "¡El buscador atrapó a todos!");
        }
    });

    // --------------------------------------------------
    // DESCONECTAR
    // --------------------------------------------------

    socket.on("disconnect", () => {
        const codigo = socket.sala;

        if (!codigo) return;

        const sala = salas.get(codigo);

        if (!sala) return;

        sala.jugadores.delete(socket.id);

        if (sala.jugadores.size === 0) {
            clearInterval(sala.intervalo);
            salas.delete(codigo);
            return;
        }

        if (sala.fase !== "esperando") {
            terminarPartida(codigo, "Un jugador se desconectó.");
        } else {
            enviarEstado(codigo);
        }
    });
});

const PUERTO = process.env.PORT || 3000;

servidor.listen(PUERTO, () => {
    console.log(`Servidor funcionando en http://localhost:${PUERTO}`);
});
