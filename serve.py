# Local dev server: python3 serve.py  ->  http://localhost:5173
import http.server, functools

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

http.server.ThreadingHTTPServer(('127.0.0.1', 5173), functools.partial(NoCache, directory=__file__.rsplit('/', 1)[0])).serve_forever()
