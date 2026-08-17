"""Yerel web sunucusu ve Paint.NET (.pdn) katman okuyucusu."""

import base64
import io
import json
import os
import tempfile
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import pypdn
from PIL import Image


ROOT = os.path.dirname(os.path.abspath(__file__))
MAX_UPLOAD_SIZE = 64 * 1024 * 1024


def blend_name(blend_mode):
    return getattr(blend_mode, 'name', str(blend_mode).split('.')[-1])


def layer_as_data_url(layer):
    image = np.asarray(layer.image, dtype=np.uint8)
    if image.ndim != 3 or image.shape[2] not in (3, 4):
        raise ValueError('PDN katmanında desteklenmeyen piksel biçimi var.')
    mode = 'RGBA' if image.shape[2] == 4 else 'RGB'
    buffer = io.BytesIO()
    Image.fromarray(image, mode=mode).save(buffer, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode('ascii')


class EditorHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        # GitHub Pages üzerindeki editörün Render API'sine erişebilmesi için.
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_POST(self):
        if self.path != '/api/open-pdn':
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length <= 0 or length > MAX_UPLOAD_SIZE:
                raise ValueError('Dosya boyutu desteklenen sınırın dışında.')
            payload = json.loads(self.rfile.read(length).decode('utf-8'))
            raw = base64.b64decode(payload['data'], validate=True)

            with tempfile.NamedTemporaryFile(suffix='.pdn', delete=False) as temp:
                temp.write(raw)
                temp_path = temp.name
            try:
                document = pypdn.read(temp_path)
            finally:
                os.unlink(temp_path)

            body = json.dumps({
                'width': document.width,
                'height': document.height,
                'layers': [{
                    'name': layer.name,
                    'visible': layer.visible,
                    'opacity': layer.opacity,
                    'blendMode': blend_name(layer.blendMode),
                    'image': layer_as_data_url(layer),
                } for layer in document.layers],
            }).encode('utf-8')
            self.send_response(HTTPStatus.OK)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as error:
            body = json.dumps({'error': str(error)}).encode('utf-8')
            self.send_response(HTTPStatus.BAD_REQUEST)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8000'))
    server = ThreadingHTTPServer(('0.0.0.0', port), EditorHandler)
    print(f'Editor: http://127.0.0.1:{port}')
    server.serve_forever()
