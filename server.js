const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const servidor = http.createServer(app);
const io = new Server(servidor);

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const salas = new Map();

const MAX_JUGADORES = 4;
const TIEMPO_CUENTA = 15;
const TIEMPO_BUSQUEDA = 200;

const LETRAS_CODIGO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// Los tres objetos que deben recoger los escondidos.
const POSICIONES_OBJETOS = [
    { id: 1, x: 200, y: 200, recogido: false },
    { id: 2, x: 700, y: 600, recogido: false },
    { id: 3, x: 1200, y: 1000, recogido: false }
];

function generarCodigo() {
    let codigo;

    do {
        codigo = "";

        for (let i = 0; i < 5; i++) {
            codigo += LETRAS_CODIGO[
                Math.floor(Math.random() * LETRAS_CODIGO.length)
            ];
        }
    } while (salas.has(codigo));

    return codigo;
}

function posicionInicial(indice) {
    const posiciones = [
        { x: 150, y: 150 },
        { x: 650, y: 150 },
        { x: 1150, y: 150 },
        { x: 650, y: 950 }
    ];

    return { ...posiciones[indice] };
}

// Zonas transitables del mapa.
function dentroDeZona(x, y) {
    const habitaciones = [
        [50, 50, 350, 300],
        [550, 50, 350, 300],
        [1050, 50, 350, 300],

        [50, 450, 350, 300],
        [550, 450, 350, 300],
        [1050, 450, 350, 300],

        [50, 850, 350, 300],
        [550, 850, 350, 300],
        [1050, 850, 350, 300]
    ];

    const pasillosHorizontales = [
        [400, 155, 150, 90],
        [900, 155, 150, 90],

        [400, 555, 150, 90],
        [900, 555, 150, 90],

        [400, 955, 150, 90],
        [900, 955, 150, 90]
    ];

    const pasillosVerticales = [
        [180, 350, 90, 100],
        [680, 350, 90, 100],
        [1180, 350, 90, 100],

        [180, 750, 90, 100],
        [680, 750, 90, 100],
        [1180, 750, 90, 100]
    ];

    const zonas = [
        ...habitaciones,
        ...pasillosHorizontales,
        ...pasillosVerticales
    ];

    return zonas.some(zona => {
        const [izquierda, arriba, ancho, alto] = zona;

        return (
            x >= izquierda + 12 &&
            x <= izquierda + ancho - 12 &&
            y >= arriba + 12 &&
            y <= arriba + alto - 12
        );
    });
}

function obtenerJugadores(sala) {
    return Array.from(sala.jugadores.values()).map(j => ({
        id: j.id,
        nombre: j.nombre,
        x: j.x,
        y: j.y,
        rol: j.rol,
        atrapado: j.atrapado
    }));
}

function enviarEstado(codigo) {
    const sala = salas.get(codigo);

    if (!sala) return;

    const roles = {};

    sala.jugadores.forEach(j => {
        roles[j.id] = j.rol;
    });

    io.to(codigo).emit("estadoSala", {
        jugadores: obtenerJugadores(sala),
        objetos: sala.objetos,
        roles: roles,
        fase: sala.fase
    });
}

function detenerReloj(sala) {
    if (sala.intervalo) {
        clearInterval(sala.intervalo);
        sala.intervalo = null;
    }
}

function terminarPartida(codigo, ganador, mensaje) {
    const sala = salas.get(codigo);

    if (!sala || sala.fase === "terminada") return;

    sala.fase = "terminada";

    detenerReloj(sala);

    io.to(codigo).emit("finPartida", {
        titulo: ganador,
        mensaje: mensaje
    });

    enviarEstado(codigo);
}

// Comienza la partida cuando entran los cuatro jugadores.
function iniciarPartida(codigo) {
    const sala = salas.get(codigo);

    if (!sala || sala.jugadores.size !== MAX_JUGADORES) return;
    if (sala.fase !== "esperando") return;

    const jugadores = Array.from(sala.jugadores.values());

    const indiceBuscador = Math.floor(
        Math.random() * jugadores.length
    );

    jugadores.forEach((jugador, indice) => {
        jugador.rol = indice === indiceBuscador
            ? "buscador"
            : "escondido";

        jugador.atrapado = false;

        const posicion = posicionInicial(indice);

        jugador.x = posicion.x;
        jugador.y = posicion.y;
    });

    sala.objetos = POSICIONES_OBJETOS.map(obj => ({
        ...obj,
        recogido: false
    }));

    sala.fase = "contando";
    sala.segundosRestantes = TIEMPO_CUENTA;
    sala.finFase = Date.now() + TIEMPO_CUENTA * 1000;

    const roles = {};

    sala.jugadores.forEach(j => {
        roles[j.id] = j.rol;
    });

    io.to(codigo).emit("inicioCuenta", {
        segundos: TIEMPO_CUENTA,
        roles: roles
    });

    enviarEstado(codigo);

    iniciarReloj(codigo);
}

function iniciarReloj(codigo) {
    const sala = salas.get(codigo);

    if (!sala) return;

    detenerReloj(sala);

    sala.intervalo = setInterval(() => {
        const salaActual = salas.get(codigo);

        if (!salaActual) return;

        const ahora = Date.now();

        const restantes = Math.max(
            0,
            Math.ceil((salaActual.finFase - ahora) / 1000)
        );

        // CUENTA DEL BUSCADOR.
        if (salaActual.fase === "contando") {
            salaActual.segundosRestantes = restantes;

            io.to(codigo).emit("cuentaActualizada", {
                segundos: restantes
            });

            if (restantes <= 0) {
                salaActual.fase = "buscando";

                salaActual.segundosRestantes = TIEMPO_BUSQUEDA;

                salaActual.finFase =
                    Date.now() + TIEMPO_BUSQUEDA * 1000;

                io.to(codigo).emit("finCuenta");

                enviarEstado(codigo);
            }

            return;
        }

        // TIEMPO DE BÚSQUEDA.
        if (salaActual.fase === "buscando") {
            salaActual.segundosRestantes = restantes;

            io.to(codigo).emit("tiempoActualizado", {
                segundos: restantes
            });

            const escondidos = Array.from(
                salaActual.jugadores.values()
            ).filter(j =>
                j.rol === "escondido" && !j.atrapado
            );

            if (escondidos.length === 0) {
                terminarPartida(
                    codigo,
                    "¡GANÓ EL BUSCADOR!",
                    "El buscador encontró a los tres jugadores."
                );

                return;
            }

            if (restantes <= 0) {
                terminarPartida(
                    codigo,
                    "¡GANARON LOS ESCONDIDOS!",
                    "Se terminó el tiempo y quedaron jugadores sin encontrar."
                );
            }
        }

    }, 250);
}

function crearSala(socket) {
    const codigo = generarCodigo();

    const sala = {
        jugadores: new Map(),
        objetos: [],
        fase: "esperando",
        segundosRestantes: 0,
        finFase: 0,
        intervalo: null
    };

    salas.set(codigo, sala);

    socket.join(codigo);
    socket.sala = codigo;

    sala.jugadores.set(socket.id, {
        id: socket.id,
        nombre: "Jugador 1",
        x: 150,
        y: 150,
        rol: "esperando",
        atrapado: false
    });

    socket.emit("salaCreada", codigo);

    enviarEstado(codigo);
}

function unirseSala(socket, codigo) {
    codigo = String(codigo || "").toUpperCase().trim();

    const sala = salas.get(codigo);

    if (!sala) {
        socket.emit("errorSala", "La sala no existe.");
        return;
    }

    if (sala.fase !== "esperando") {
        socket.emit("errorSala", "La partida ya comenzó.");
        return;
    }

    if (sala.jugadores.size >= MAX_JUGADORES) {
        socket.emit("errorSala", "La sala está llena.");
        return;
    }

    socket.join(codigo);
    socket.sala = codigo;

    const numero = sala.jugadores.size + 1;

    sala.jugadores.set(socket.id, {
        id: socket.id,
        nombre: "Jugador " + numero,
        x: 150,
        y: 150,
        rol: "esperando",
        atrapado: false
    });

    socket.emit("unidoSala", codigo);

    enviarEstado(codigo);

    if (sala.jugadores.size === MAX_JUGADORES) {
        iniciarPartida(codigo);
    }
}

io.on("connection", socket => {
    console.log("Jugador conectado:", socket.id);

    socket.on("crearSala", () => {
        crearSala(socket);
    });

    socket.on("unirseSala", codigo => {
        unirseSala(socket, codigo);
    });

    // MOVIMIENTO.
    socket.on("moverJugador", datos => {
        const codigo = socket.sala;

        if (!codigo) return;

        const sala = salas.get(codigo);

        if (!sala) return;

        const jugador = sala.jugadores.get(socket.id);

        if (!jugador || jugador.atrapado) return;

        // El buscador no puede moverse durante la cuenta.
        if (
            sala.fase === "contando" &&
            jugador.rol === "buscador"
        ) {
            return;
        }

        if (
            sala.fase !== "contando" &&
            sala.fase !== "buscando"
        ) {
            return;
        }

        const x = Number(datos?.x);
        const y = Number(datos?.y);

        if (!Number.isFinite(x) || !Number.isFinite(y)) return;

        // Evita saltos de posición demasiado grandes.
        const distancia = Math.hypot(
            x - jugador.x,
            y - jugador.y
        );

        if (distancia > 15) return;

        if (!dentroDeZona(x, y)) return;

        jugador.x = x;
        jugador.y = y;

        // Los escondidos pueden recoger objetos durante la búsqueda.
        if (
            jugador.rol === "escondido" &&
            sala.fase === "buscando"
        ) {
            for (const objeto of sala.objetos) {
                if (objeto.recogido) continue;

                const distanciaObjeto = Math.hypot(
                    jugador.x - objeto.x,
                    jugador.y - objeto.y
                );

                if (distanciaObjeto <= 35) {
                    objeto.recogido = true;

                    const cantidad = sala.objetos.filter(
                        o => o.recogido
                    ).length;

                    io.to(codigo).emit("objetoRecogido", {
                        nombre: jugador.nombre,
                        cantidad: cantidad,
                        completados: cantidad === 3
                    });

                    enviarEstado(codigo);

                    // Si recogen los tres objetos, ganan los escondidos.
                    if (cantidad === 3) {
                        terminarPartida(
                            codigo,
                            "¡GANARON LOS ESCONDIDOS!",
                            "Los escondidos consiguieron recoger las tres estrellas."
                        );

                        return;
                    }
                }
            }
        }

        enviarEstado(codigo);
    });

    // ATRAPAR A UN ESCONDIDO.
    socket.on("intentarAtrapar", () => {
        const codigo = socket.sala;

        if (!codigo) return;

        const sala = salas.get(codigo);

        if (!sala || sala.fase !== "buscando") return;

        const buscador = sala.jugadores.get(socket.id);

        if (
            !buscador ||
            buscador.rol !== "buscador" ||
            buscador.atrapado
        ) {
            return;
        }

        let jugadorAtrapado = null;

        for (const jugador of sala.jugadores.values()) {
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

            if (distancia <= 55) {
                jugadorAtrapado = jugador;
                break;
            }
        }

        if (!jugadorAtrapado) return;

        jugadorAtrapado.atrapado = true;

        io.to(codigo).emit("jugadorAtrapado", {
            nombre: jugadorAtrapado.nombre
        });

        enviarEstado(codigo);

        const escondidosRestantes = Array.from(
            sala.jugadores.values()
        ).filter(j =>
            j.rol === "escondido" && !j.atrapado
        );

        if (escondidosRestantes.length === 0) {
            terminarPartida(
                codigo,
                "¡GANÓ EL BUSCADOR!",
                "Encontró a todos los jugadores escondidos."
            );
        }
    });

    // DESCONEXIÓN.
    socket.on("disconnect", () => {
        console.log("Jugador desconectado:", socket.id);

        const codigo = socket.sala;

        if (!codigo) return;

        const sala = salas.get(codigo);

        if (!sala) return;

        sala.jugadores.delete(socket.id);

        if (sala.jugadores.size === 0) {
            detenerReloj(sala);
            salas.delete(codigo);
            return;
        }

        if (
            sala.fase !== "esperando" &&
            sala.fase !== "terminada"
        ) {
            terminarPartida(
                codigo,
                "PARTIDA INTERRUMPIDA",
                "Un jugador se desconectó."
            );

            return;
        }

        enviarEstado(codigo);
    });
});

servidor.listen(PORT, () => {
    console.log(
        "Servidor iniciado en http://localhost:" + PORT
    );
});
