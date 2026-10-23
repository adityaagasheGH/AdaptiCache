"""Start AdaptiCache:  python run.py   (then open the address it prints)."""

import sys

from adapticache.__main__ import main

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or ["serve"]))
