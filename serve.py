#!/usr/bin/env python3
"""Lokaler Dev-Server ohne Caching.

`python3 -m http.server` liefert keine Cache-Header; Chrome cacht dann
nach Heuristik -- besonders tueckisch beim CSG-Worker (ESM-Module werden
beim Hard-Reload NICHT zuverlaessig erneuert, der alte Rechenkern lebt
im Cache weiter). Dieser Server sendet no-store, damit jede Aenderung
sofort im Browser ankommt.

Lauf:  python3 serve.py [port]   (Standard 8000)
"""
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class OhneCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print('Klotzwerk auf http://localhost:%d/ (Cache aus)' % port)
HTTPServer(('', port), OhneCache).serve_forever()
