const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const salas = new Map();

// =========================
// GENERAR CÓDIGO DE SALA
// =========================
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

// =========================
// CONEXIONES
// =========================
io.on("connection", (socket) => {

    console.log("Jugador conectado:", socket.id);

    // =========================
    // CREAR SALA
    // =========================
    socket.on("crearSala", () => {

        let codigo;

        do {
            codigo = generarCodigo();
        } while (salas.has(codigo));

        salas.set(codigo, new Map());

        socket.join(codigo);
        socket.sala = codigo;

        const jugador = {
            id: socket.id,
            x: 200,
            y: 200
        };

        salas.get(codigo).set(socket.id, jugador);

        socket.emit("salaCreada", {
            codigo: codigo,
            jugadores: salas.get(codigo).size
        });

        enviarJugadores(codigo);

        console.log(`Sala ${codigo} creada`);
    });

    // =========================
    // UNIRSE A SALA
    // =========================
    socket.on("unirseSala", (codigoRecibido) => {

        const codigo = String(codigoRecibido)
            .trim()
            .toUpperCase();

        const sala = salas.get(codigo);

        if (!sala) {
            socket.emit("errorSala", "La sala no existe.");
            return;
        }

        if (sala.size >= 4) {
            socket.emit("errorSala", "La sala está llena.");
            return;
        }

        // Evitar que un jugador ya conectado
        // cambie de sala sin salir de la anterior.
        if (socket.sala) {
            socket.emit(
                "errorSala",
                "Ya estás conectado a una sala."
            );
            return;
        }

        socket.join(codigo);
        socket.sala = codigo;

        const jugador = {
            id: socket.id,
            x: 600,
            y: 200
        };

        sala.set(socket.id, jugador);

        socket.emit("salaCreada", {
            codigo: codigo,
            jugadores: sala.size
        });

        enviarJugadores(codigo);

        console.log(`Jugador ${socket.id} se unió a ${codigo}`);
    });

    // =========================
    // MOVIMIENTO
    // =========================
    socket.on("moverJugador", (posicion) => {

        if (!socket.sala) return;

        const sala = salas.get(socket.sala);

        if (!sala) return;

        const jugador = sala.get(socket.id);

        if (!jugador) return;

        if (
            !posicion ||
            typeof posicion.x !== "number" ||
            typeof posicion.y !== "number" ||
            !Number.isFinite(posicion.x) ||
            !Number.isFinite(posicion.y)
        ) {
            return;
        }

        jugador.x = posicion.x;
        jugador.y = posicion.y;

        enviarJugadores(socket.sala);
    });

    // =========================
    // DESCONECTARSE
    // =========================
    socket.on("disconnect", () => {

        const codigo = socket.sala;

        if (!codigo) {
            console.log("Jugador desconectado:", socket.id);
            return;
        }

        const sala = salas.get(codigo);

        if (!sala) {
            console.log("Jugador desconectado:", socket.id);
            return;
        }

        sala.delete(socket.id);

        if (sala.size === 0) {
            salas.delete(codigo);
        } else {
            // Actualizar jugadores y mostrar de nuevo
            // el aviso si ya no están los cuatro.
            enviarJugadores(codigo);
        }

        console.log("Jugador desconectado:", socket.id);
    });

});

// =========================
// ACTUALIZAR JUGADORES Y ESTADO
// =========================
function enviarJugadores(codigo) {

    const sala = salas.get(codigo);

    if (!sala) return;

    const jugadores = Array.from(sala.values());

    // Enviar las posiciones y los jugadores
    io.to(codigo).emit("actualizarJugadores", jugadores);

    // Avisar a todos si la sala está completa
    io.to(codigo).emit("estadoSala", {
        cantidad: jugadores.length,
        completa: jugadores.length === 4
    });
}

// =========================
// INICIAR SERVIDOR
// =========================
const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor iniciado en http://localhost:${PORT}`);
});
