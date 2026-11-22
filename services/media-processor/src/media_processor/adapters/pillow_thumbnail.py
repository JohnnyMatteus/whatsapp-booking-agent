"""Miniatura JPEG com Pillow."""

from __future__ import annotations

import io

from PIL import Image, ImageOps, UnidentifiedImageError

from ..domain import MediaRejected, RejectionReason

THUMBNAIL_SIZE = (256, 256)


class PillowThumbnailGenerator:
    def generate(self, image: bytes) -> bytes:
        try:
            with Image.open(io.BytesIO(image)) as source:
                # Fotos de celular vêm giradas por EXIF; Pillow não aplica sozinho.
                oriented = ImageOps.exif_transpose(source)
                oriented.thumbnail(THUMBNAIL_SIZE)
                out = io.BytesIO()
                oriented.convert("RGB").save(out, format="JPEG", quality=80)
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError):
            raise MediaRejected(RejectionReason.CORRUPT) from None
        return out.getvalue()
