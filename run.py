#!/usr/bin/env python3
"""
Universal launcher for Slime-MD on common hosts (Render, Railway, Replit, VPS, etc).

Behavior:
- Ensures Node dependencies are installed when needed.
- Honors PORT/HOST env vars used by many hosts.
- Starts the bot with `npm start` and streams logs.
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NODE_MODULES = ROOT / 'node_modules'
PACKAGE_JSON = ROOT / 'package.json'


def run(cmd, check=True):
    process = subprocess.run(cmd, cwd=str(ROOT), check=check)
    return process.returncode


def ensure_node():
    if not shutil.which('node'):
        print('❌ Node.js is not installed or not in PATH.')
        sys.exit(1)
    if not shutil.which('npm'):
        print('❌ npm is not installed or not in PATH.')
        sys.exit(1)


def ensure_dependencies():
    if not PACKAGE_JSON.exists():
        print('❌ package.json not found.')
        sys.exit(1)

    if NODE_MODULES.exists():
        return

    print('📦 Installing dependencies (npm install)...')
    run(['npm', 'install'])


def start_bot():
    env = os.environ.copy()

    # Widely used by PaaS providers; harmless for this bot process.
    env.setdefault('HOST', '0.0.0.0')
    env.setdefault('PORT', env.get('PORT', '3000'))

    print('🚀 Starting Slime-MD via npm start...')
    os.execvpe('npm', ['npm', 'start'], env)


def main():
    ensure_node()
    ensure_dependencies()
    start_bot()


if __name__ == '__main__':
    main()
