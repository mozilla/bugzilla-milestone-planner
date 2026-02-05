#!/bin/bash
# Build script for Cloudflare Pages deployment
# Generates version.json with commit info

echo "{\"commit\":\"${CF_PAGES_COMMIT_SHA:-local}\",\"date\":\"$(date -u +%Y-%m-%d)\"}" > version.json
