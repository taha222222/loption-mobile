"""Minimal SMTP sink for the local end-to-end harness (standard library only).

Accepts every message from the local Auth container and writes it to
<outdir>/<n>.eml so the harness can read the verification link. Never
relays anything. Run: python3 -I smtp_sink.py <port> <outdir>
"""
import asyncio
import os
import sys

PORT = int(sys.argv[1])
OUTDIR = sys.argv[2]
os.makedirs(OUTDIR, exist_ok=True)
counter = 0


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    global counter

    def send(line: str) -> None:
        writer.write((line + "\r\n").encode())

    send("220 sink ESMTP")
    await writer.drain()
    in_data = False
    lines: list[str] = []
    while True:
        raw = await reader.readline()
        if not raw:
            break
        line = raw.decode(errors="replace").rstrip("\r\n")
        if in_data:
            if line == ".":
                counter += 1
                with open(os.path.join(OUTDIR, f"{counter:04d}.eml"), "w") as f:
                    f.write("\n".join(lines))
                lines = []
                in_data = False
                send("250 OK queued")
            else:
                lines.append(line[1:] if line.startswith("..") else line)
            await writer.drain()
            continue
        cmd = line.split(" ", 1)[0].upper()
        if cmd in ("EHLO", "HELO"):
            send("250-sink")
            send("250 8BITMIME")
        elif cmd in ("MAIL", "RCPT", "RSET", "NOOP"):
            send("250 OK")
        elif cmd == "DATA":
            in_data = True
            send("354 End data with <CR><LF>.<CR><LF>")
        elif cmd == "QUIT":
            send("221 Bye")
            await writer.drain()
            break
        else:
            send("502 Command not implemented")
        await writer.drain()
    writer.close()


async def main() -> None:
    server = await asyncio.start_server(handle, "0.0.0.0", PORT)
    async with server:
        await server.serve_forever()


asyncio.run(main())
