#!/usr/bin/env python3
"""
Servidor HTTP simple para el simulador FLUVI
Ejecuta este script y abre http://localhost:8000 en tu navegador
"""

import http.server
import socketserver
import os
import sys
import socket

# Configuración
PORT = 8000
DIRECTORY = "."

def get_local_ip():
    """Obtiene la IP local de la máquina"""
    try:
        # Crear un socket para obtener la IP local
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        return local_ip
    except Exception:
        return "No disponible"

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Agregar headers CORS para evitar problemas
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

def main():
    local_ip = get_local_ip()

    print("=" * 60)
    print("SERVIDOR WEB DE PRUEBAS PARA FLUVI - SIMULADOR DE TRAFICO")
    print("=" * 60)
    print(f"\nSirviendo archivos desde: {os.path.abspath(DIRECTORY)}")
    print(f"Puerto: {PORT}")
    print(f"\nServidor iniciado correctamente!")
    print(f"\n📱 Abre tu navegador y ve a:")
    print(f"\n   💻 Desde esta PC:")
    print(f"      http://localhost:{PORT}")
    print(f"      http://127.0.0.1:{PORT}")

    if local_ip != "No disponible":
        print(f"\n   📱 Desde tu PC/celular/tablet (misma red WiFi):")
        print(f"      http://{local_ip}:{PORT}")
        print(f"\n   ⚠️  Si no funciona desde el celular:")
        print(f"      1. Verifica que estén en la misma red WiFi")
        print(f"      2. Permite el acceso en el Firewall de Windows")
        print(f"      3. Comando: netsh advfirewall firewall add rule name=\"FLUVI Server\" dir=in action=allow protocol=TCP localport={PORT}")

    print(f"\n   Para detener el servidor, presiona Ctrl+C")
    print("=" * 60 + "\n")

    try:
        # Escuchar en todas las interfaces de red (0.0.0.0)
        with socketserver.TCPServer(("0.0.0.0", PORT), MyHTTPRequestHandler) as httpd:
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n\nServidor detenido por el usuario")
        sys.exit(0)
    except OSError as e:
        if e.errno == 10048:  # Puerto en uso (Windows)
            print(f"\nERROR: El puerto {PORT} ya esta en uso.")
            print(f"   Intenta cerrar otros servidores o usa otro puerto.")
        else:
            print(f"\nERROR: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
