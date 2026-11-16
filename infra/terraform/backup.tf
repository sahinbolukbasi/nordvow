# Otomatik AWS Backup kasası ve günlük/haftalık yedekleme planı (RDS + S3 Assets).

resource "aws_backup_vault" "main" {
  name = "${local.name}-backup-vault"
}

data "aws_iam_policy_document" "backup_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["backup.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "backup" {
  name               = "${local.name}-backup"
  assume_role_policy = data.aws_iam_policy_document.backup_assume.json
}

resource "aws_iam_role_policy_attachment" "backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup"
}

resource "aws_iam_role_policy_attachment" "restore" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForRestores"
}

resource "aws_iam_role_policy_attachment" "s3_backup" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/AWSBackupServiceRolePolicyForS3Backup"
}

resource "aws_iam_role_policy_attachment" "s3_restore" {
  role       = aws_iam_role.backup.name
  policy_arn = "arn:aws:iam::aws:policy/AWSBackupServiceRolePolicyForS3Restore"
}

resource "aws_backup_plan" "main" {
  name = "${local.name}-backup-plan"

  # Günlük yedek: her gün 02:00 UTC (05:00 İstanbul), 35 gün saklanır.
  rule {
    rule_name         = "daily-backup"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 2 * * ? *)"
    start_window      = 60
    completion_window = 180

    lifecycle {
      delete_after = 35
    }
  }

  # Haftalık uzun süreli yedek: her Pazar 03:00 UTC (06:00 İstanbul), 90 gün saklanır.
  rule {
    rule_name         = "weekly-backup"
    target_vault_name = aws_backup_vault.main.name
    schedule          = "cron(0 3 ? * SUN *)"
    start_window      = 60
    completion_window = 240

    lifecycle {
      delete_after = 90
    }
  }
}

resource "aws_backup_selection" "main" {
  iam_role_arn = aws_iam_role.backup.arn
  name         = "${local.name}-rds-and-s3"
  plan_id      = aws_backup_plan.main.id

  resources = [
    aws_db_instance.main.arn,
    aws_s3_bucket.assets.arn,
  ]
}
