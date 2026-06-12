#!/bin/bash
DB_FILE="/home/campin/Rubinot/server-data/rubinot.db"
BACKUP_DIR="/home/campin/Rubinot/server-data/backups"
LOG_DIR="/home/campin/Rubinot/logs"

mkdir -p "$BACKUP_DIR" "$LOG_DIR"

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/rubinot_$DATE.db"

# Copia atômica via sqlite3 para evitar backup de DB corrompido
sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"

# Mantém apenas os últimos 30 backups
ls -t "$BACKUP_DIR"/rubinot_*.db 2>/dev/null | tail -n +31 | xargs -r rm

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup criado: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
