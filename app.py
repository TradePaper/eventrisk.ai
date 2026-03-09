import os

import uvicorn

from catalog_app import app


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("catalog_app:app", host="0.0.0.0", port=port, reload=False)
