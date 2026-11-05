const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const servidor = http.createServer(app);
const io = new Server(servidor);

const PORT = 3000;

app.use(express.static("public"));

const salas = new Map();

const TIEMPO_CUENTA = 15;
const TIEMPO_BUSQUEDA = 200;

function generarCodigo() {
    const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let codigo = "";

    for (let i = 0; i < 5; i++) {
        codigo += letras[Math.floor(Math.random() * letras.length)];
    }

    return codigo;
}

function crearObjetos() {
    return [
        {id: 1, x: 200, y: 200, recogido: false},
        {id: 2, x: 700, y: 600, recogido: false},
        {id: 3, x: 1200, y: 1000, recogido: false}
    ];
}

function crearJugadoresIniciales() {
    return [
        {x: 150, y: 150},
        {x: 650, y: 150},
        {x: 1150, y: 150},
        {x: 650, y: 950}
    ];
}

function dentroDeZona(x, y) {
    const habitaciones = [
        {x:50,y:50}, {x:550,y:50}, {x:1050,y:50},
        {x:50,y:450}, {x:550,y:450}, {x:1050,y:450},
        {x:50,y:850}, {x:550,y:850}, {x:1050,y:850}
    ];

    for (const h of habitaciones) {
        if (x >= h.x + 13 && x <= h.x + 337 &&
            y >= h.y + 13 && y <= h.y + 287) {
            return true;
        }
    }

    for (let fila = 0; fila < 3; fila++) {
        for (let col = 0; col < 2; col++) {
            const cx = 400 + col * 500;
            const cy = 155 + fila * 400;

            if (x >= cx && x <= cx + 150 &&
                y >= cy && y <= cy + 90) {
                return true;
            }
        }
    }

    for (let fila = 0; fila < 2; fila++) {
        for (let col = 0; col < 3; col++) {
            const cx = 180 + col * 500;
            const cy = 350 + fila * 400;

            if (x >= cx && x <= cx + 90 &&
                y >= cy && y <= cy + 100) {
                return true;
            }
        }
    }

    return false;
}

function cruzaPared(ax, ay, bx, by) {
    const habitaciones = [
        {x:50,y:50}, {x:550,y:50}, {x:1050,y:50},
        {x:50,y:450}, {x:550,y:450}, {x:1050,y:450},
        {x:50,y:850}, {x:550,y:850}, {x:1050,y:850}
    ];

    for (const h of habitaciones) {
        const izquierda = h.x + 13;
        const derecha = h.x + 337;
        const arriba = h.y + 13;
        const abajo = h.y + 287;

        if (ax <= derecha && bx > derecha) {
            if (Math.abs(by - (h.y + 150)) > 24) return true;
        }

        if (ax > derecha && bx <= derecha) {
            if (Math.abs(by - (h.y + 150)) > 24) return true;
        }

        if (ax >= izquierda && bx < izquierda) {
            if (Math.abs(by - (h.y + 150)) > 24) return true;
        }

        if (ax < izquierda && bx >= izquierda) {
            if (Math.abs(by - (h.y + 150)) > 24) return true;
        }

        if (ay >= arriba && by < arriba) {
            if (Math.abs(bx - (h.x + 175)) > 24) return true;
        }

        if (ay <= abajo && by > abajo) {
            if (Math.abs(bx - (h.x + 175)) > 24) return true;
        }

        if (ay < arriba && by >= arriba) {
            if (Math.abs(bx - (h.x + 175)) > 24) return true;
        }

        if (ay > abajo && by <= abajo) {
            if (Math.abs(bx - (h.x + 175)) > 24) return true;
        }
    }

    return false;
}

function enviarEstado(codigo) {
    const sala = salas.get(codigo);
    if (!sala) return;

    for (const [id, jugador] of sala.jugadores) {
        io.to(id).emit("estadoSala", {
            jugadores: Object.fromEntries(sala.jugadores),
            objetos: sala.objetos,
            fase: sala.fase,
            miRol: jugador.rol
        });
    }
}

function terminarPartida(codigo, ganador) {
    const sala = salas.get(codigo);
    if (!sala || sala.fase === "terminada") return;

    sala.fase = "terminada";

    clearInterval(sala.intervaloCuenta);
    clearInterval(sala.intervaloBusqueda);

    io.to(codigo).emit("finPartida", ganador);
}

function iniciarPartida(codigo) {
    const sala = salas.get(codigo);
    if (!sala || sala.jugadores.size !== 4) return;

    const jugadores = [...sala.jugadores.values()];

    const buscadorIndex = Math.floor(Math.random() * jugadores.length);

    jugadores.forEach((jugador, index) => {
        jugador.rol = index === buscadorIndex ? "buscador" : "escondido";
        jugador.atrapado = false;
    });

    sala.fase = "cuenta";
    sala.tiempo = TIEMPO_CUENTA;
    sala.objetos = crearObjetos();

    const posiciones = crearJugadoresIniciales();

    jugadores.forEach((jugador, index) => {
        jugador.x = posiciones[index].x;
        jugador.y = posiciones[index].y;
    });

    io.to(codigo).emit("inicioCuenta");
    enviarEstado(codigo);

    sala.intervaloCuenta = setInterval(() => {
        sala.tiempo--;

        io.to(codigo).emit("cuentaActualizada", sala.tiempo);

        if (sala.tiempo <= 0) {
            clearInterval(sala.intervaloCuenta);

            sala.fase = "busqueda";
            sala.tiempo = TIEMPO_BUSQUEDA;

            io.to(codigo).emit("finCuenta");
            enviarEstado(codigo);

            iniciarTemporizadorBusqueda(codigo);
        }
    }, 1000);
}

function iniciarTemporizadorBusqueda(codigo) {
    const sala = salas.get(codigo);
    if (!sala) return;

    sala.intervaloBusqueda = setInterval(() => {
        if (sala.fase !== "busqueda") {
            clearInterval(sala.intervaloBusqueda);
            return;
        }

        sala.tiempo--;

        io.to(codigo).emit("tiempoActualizado", sala.tiempo);

        if (sala.tiempo <= 0) {
            terminarPartida(codigo, "¡GANAN LOS ESCONDIDOS!");
        }
    }, 1000);
}

io.on("connection", socket => {

    socket.on("crearSala", () => {
        let codigo;

        do {
            codigo = generarCodigo();
        } while (salas.has(codigo));

        const sala = {
            jugadores: new Map(),
            objetos: crearObjetos(),
            fase: "esperando",
            tiempo: 0,
            intervaloCuenta: null,
            intervaloBusqueda: null
        };

        salas.set(codigo, sala);

        socket.join(codigo);
        socket.sala = codigo;

        sala.jugadores.set(socket.id, {
            id: socket.id,
            x: 150,
            y: 150,
            rol: null,
            atrapado: false
        });

        socket.emit("salaCreada", codigo);
        socket.emit("unidoSala", codigo);

        enviarEstado(codigo);
    });

    socket.on("unirseSala", codigo => {
        codigo = String(codigo || "").toUpperCase().trim();

        const sala = salas.get(codigo);

        if (!sala) {
            socket.emit("errorSala", "La sala no existe.");
            return;
        }

        if (sala.jugadores.size >= 4) {
            socket.emit("errorSala", "La sala está completa.");
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
            x: 150,
            y: 150,
            rol: null,
            atrapado: false
        });

        socket.emit("unidoSala", codigo);

        enviarEstado(codigo);

        if (sala.jugadores.size === 4) {
            iniciarPartida(codigo);
        }
    });

    socket.on("moverJugador", datos => {
        const codigo = socket.sala;
        const sala = salas.get(codigo);

        if (!sala || !datos) return;

        const jugador = sala.jugadores.get(socket.id);
        if (!jugador || jugador.atrapado) return;

        if (sala.fase === "esperando" || sala.fase === "terminada") return;
        if (sala.fase === "cuenta" && jugador.rol === "buscador") return;

        const nuevoX = Number(datos.x);
        const nuevoY = Number(datos.y);

        if (!Number.isFinite(nuevoX) || !Number.isFinite(nuevoY)) return;

        const distancia = Math.hypot(nuevoX - jugador.x, nuevoY - jugador.y);

        if (distancia > 15) return;

        if (!dentroDeZona(nuevoX, nuevoY)) return;

        if (cruzaPared(jugador.x, jugador.y, nuevoX, nuevoY)) return;

        jugador.x = nuevoX;
        jugador.y = nuevoY;

        // Recoger estrellas.
        if (jugador.rol === "escondido" && sala.fase === "busqueda") {
            for (const objeto of sala.objetos) {
                if (objeto.recogido) continue;

                const distanciaObjeto = Math.hypot(
                    jugador.x - objeto.x,
                    jugador.y - objeto.y
                );

                if (distanciaObjeto < 30) {
                    objeto.recogido = true;

                    io.to(codigo).emit("objetoRecogido", {
                        objetos: sala.objetos
                    });

                    if (sala.objetos.every(o => o.recogido)) {
                        terminarPartida(codigo, "¡LOS ESCONDIDOS COMPLETARON EL OBJETIVO!");
                        return;
                    }
                }
            }
        }

        enviarEstado(codigo);
    });

    socket.on("atrapar", () => {
        const codigo = socket.sala;
        const sala = salas.get(codigo);

        if (!sala || sala.fase !== "busqueda") return;

        const buscador = sala.jugadores.get(socket.id);

        if (!buscador || buscador.rol !== "buscador") return;

        for (const [id, jugador] of sala.jugadores) {
            if (jugador.rol !== "escondido" || jugador.atrapado) continue;

            const distancia = Math.hypot(
                buscador.x - jugador.x,
                buscador.y - jugador.y
            );

            if (distancia <= 55) {
                jugador.atrapado = true;

                io.to(codigo).emit("jugadorAtrapado", {
                    jugadores: Object.fromEntries(sala.jugadores)
                });
            }
        }

        const escondidosRestantes = [...sala.jugadores.values()]
            .filter(j => j.rol === "escondido" && !j.atrapado);

        if (escondidosRestantes.length === 0) {
            terminarPartida(codigo, "¡GANA EL BUSCADOR!");
        } else {
            enviarEstado(codigo);
        }
    });

    socket.on("disconnect", () => {
        const codigo = socket.sala;
        const sala = salas.get(codigo);

        if (!sala) return;

        sala.jugadores.delete(socket.id);

        if (sala.jugadores.size === 0) {
            clearInterval(sala.intervaloCuenta);
            clearInterval(sala.intervaloBusqueda);
            salas.delete(codigo);
        } else {
            enviarEstado(codigo);
        }
    });
});

servidor.listen(PORT, () => {
    console.log(`Servidor iniciado en http://localhost:${PORT}`);
});
