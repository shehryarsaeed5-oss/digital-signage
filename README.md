# Digital Signage MVP

Minimal LAN-only digital signage system built with Node.js, Express, EJS, and SQLite.

## Features

- Admin login with session auth
- Upload JPG, PNG, and MP4 files
- Store uploads in `public/uploads_test`
- Manage a single ordered playlist
- Cinema player screen at `/player/cinema`
- Cinema 3x2 player screen at `/player/cinema-3x2`
- Cinema portrait player screen at `/player/cinema-portrait`
- Playlist API at `/api/playlist`

## Default Login

- Username: `admin`
- Password: `password`

You can override them with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.

## Run

```bash
npm install
npm start
```

Then open:

- Admin: `http://localhost:3000/admin`
- Cinema Player: `http://localhost:3000/player/cinema`
- Cinema Player 3x2: `http://localhost:3000/player/cinema-3x2`
- Cinema Portrait Player: `http://localhost:3000/player/cinema-portrait`
