#!/usr/bin/env bash
# Aylık RDS Snapshot Geri Yükleme Tatbikatı (canlı DB'ye dokunmaz; geçici instance kurup doğrular ve siler).
# Kullanım: AWS_PROFILE=sahinbolukbasi ./scripts/dr-restore-drill.sh
set -euo pipefail

PROFILE="${AWS_PROFILE:-sahinbolukbasi}"
REGION="${AWS_REGION:-eu-central-1}"
DB_ID="${DB_IDENTIFIER:-infulancer-prod}"
DRILL_ID="${DB_ID}-dr-drill-$(date +%Y%m%d%H%M)"
export AWS_PROFILE="$PROFILE" AWS_REGION="$REGION"

echo "[1/4] Son başarılı RDS otomatik yedeği bulunuyor ($DB_ID)..."
SNAP_ID="$(aws rds describe-db-snapshots --region "$REGION" \
  --db-instance-identifier "$DB_ID" --snapshot-type automated \
  --query 'sort_by(DBSnapshots, &SnapshotCreateTime)[-1].DBSnapshotIdentifier' \
  --output text)"

if [[ -z "$SNAP_ID" || "$SNAP_ID" == "None" ]]; then
  echo "HATA: Otomatik snapshot bulunamadı." >&2
  exit 1
fi

echo "[2/4] Geçici doğrulama instance'ı başlatılıyor: $DRILL_ID ($SNAP_ID)"
START_TS="$(date +%s)"
aws rds restore-db-instance-from-db-snapshot --region "$REGION" \
  --db-instance-identifier "$DRILL_ID" \
  --db-snapshot-identifier "$SNAP_ID" \
  --db-instance-class db.t4g.micro \
  --no-publicly-accessible >/dev/null

aws rds wait db-instance-available --region "$REGION" --db-instance-identifier "$DRILL_ID"
END_TS="$(date +%s)"
echo "[3/4] Snapshot erişilebilir ve sağlıklı. Ölçülen RTO: $((END_TS - START_TS)) sn."

echo "[4/4] Geçici doğrulama instance'ı temizleniyor..."
aws rds delete-db-instance --region "$REGION" \
  --db-instance-identifier "$DRILL_ID" \
  --skip-final-snapshot --delete-automated-backups >/dev/null

echo "DR tatbikatı BAŞARILI: $SNAP_ID"

