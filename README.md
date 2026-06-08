# MeetCauca

MeetCauca es una aplicacion web de videollamadas educativas en tiempo real. El proyecto permite crear salas virtuales para clases, conectar estudiantes y profesor, transmitir audio/video, enviar chat, usar reacciones, organizar turnos de palabra, lanzar encuestas rapidas y medir la comprension de la clase con un semaforo.

## Caracteristicas

- Videollamada en tiempo real con WebRTC y Mediasoup.
- Multiples salas independientes.
- Roles de Profesor y Estudiante.
- Solo se permite un profesor por sala.
- No se permiten nombres repetidos dentro de la misma sala.
- Chat de sala.
- Reacciones con emojis.
- Modo Clase para ordenar la participacion.
- Cola de turnos para pedir la palabra.
- Opcion del profesor para silenciar a todos.
- Encuestas rapidas en vivo.
- Semaforo de comprension: verde, amarillo y rojo.

## Tecnologias

- HTML, CSS y JavaScript
- Vite
- Node.js
- Express
- Socket.io
- Mediasoup
- Mediasoup Client
- WebRTC

## Pantallazos

### Lobby

![Lobby de MeetCauca](docs/screenshots/lobby-preview.png)

### Sala de clase

![Sala de MeetCauca](docs/screenshots/sala-preview.png)

### Arquitectura

![Diagrama de arquitectura](docs/screenshots/arquitectura.png)

### Flujo del sistema

![Diagrama de flujo](docs/screenshots/flujo.png)

## Instalacion

Clona el repositorio y entra a la carpeta del proyecto:

```bash
git clone <url-del-repositorio>
cd proyecto_final.fc
```

Instala las dependencias:

```bash
npm install
```

## Configuracion de IP

El proyecto usa una IP local para que WebRTC y Socket.io puedan comunicarse en la red.

Actualmente esta configurado con:

```txt
192.168.1.39
```

Si vas a probar en otra red o en otro computador, cambia esa IP en estos archivos:

En `src/voice.js`:

```js
const SERVER_URL = 'http://TU_IP:3000';
```

En `server.js`:

```js
announcedIp: 'TU_IP'
```

Para saber tu IP en Windows:

```powershell
ipconfig
```

Usa la direccion IPv4 del adaptador Wi-Fi o Ethernet que tenga puerta de enlace predeterminada.

Si vas a probar solamente en el mismo computador, puedes usar:

```js
const SERVER_URL = 'http://127.0.0.1:3000';
```

Y en `server.js`:

```js
announcedIp: '127.0.0.1'
```

## Ejecucion

Abre una terminal para el servidor:

```bash
npm run server
```

Deja esa terminal abierta.

Abre otra terminal para el frontend:

```bash
npm run dev
```

Luego abre en el navegador:

```txt
http://127.0.0.1:5173/
```

Si vas a entrar desde otro equipo en la misma red, abre:

```txt
http://TU_IP:5173/
```

## Como probar

1. Abre la aplicacion en una pestana del navegador.
2. Ingresa un nombre, por ejemplo `Profesor Demo`.
3. Escribe el nombre de la sala, por ejemplo `clase prueba`.
4. Selecciona el rol `Profesor`.
5. Haz clic en `Unirse a la sala`.
6. Abre otra pestana con la misma URL.
7. Ingresa con otro nombre y selecciona `Estudiante`.
8. Usa exactamente el mismo nombre de sala.

Pruebas recomendadas:

- Intentar entrar con dos profesores en la misma sala.
- Intentar repetir el mismo nombre en la misma sala.
- Enviar mensajes por chat.
- Probar reacciones.
- Activar Modo Clase.
- Pedir la palabra como estudiante.
- Lanzar una encuesta como profesor.
- Responder la encuesta como estudiante.
- Marcar el semaforo de comprension.
- Salir de la sala y verificar que los demas participantes sean notificados.

## Estructura del proyecto

```txt
proyecto_final.fc/
├── css/
│   └── style.css
├── docs/
│   └── screenshots/
├── src/
│   └── voice.js
├── index.html
├── server.js
├── package.json
├── vite.config.js
└── README.md
```

## Scripts disponibles

```bash
npm run server
```

Inicia el servidor Node.js con Express, Socket.io y Mediasoup.

```bash
npm run dev
```

Inicia el servidor de desarrollo de Vite para el frontend.

## Notas

- Para pruebas con camara y microfono, el navegador debe tener permisos habilitados.
- Para pruebas en red local, todos los dispositivos deben estar en la misma red.
- En algunos navegadores, WebRTC puede requerir HTTPS si se despliega fuera de `localhost`.
- El estado de las salas se guarda en memoria; si el servidor se reinicia, las salas activas se pierden.

## Autor

Proyecto academico desarrollado como prototipo de videollamadas educativas con tecnologias web en tiempo real.
