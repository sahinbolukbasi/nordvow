terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Türkiye (+90) SIP Trunk bağlamak için Amazon Chime SDK Voice Connector
resource "aws_chime_voice_connector" "tr_sip" {
  name               = "${var.service_name}-vc"
  require_encryption = true
  aws_region         = var.aws_region
}

resource "aws_chime_voice_connector_termination" "tr_termination" {
  voice_connector_id = aws_chime_voice_connector.tr_sip.id
  cps_limit          = 2
  calling_regions    = ["TR"]
  cidr_allow_list    = var.sip_origination_cidrs
}

# Belgeler ve çağrı kayıtları için düşük maliyetli S3 kovası
resource "aws_s3_bucket" "knowledge_and_logs" {
  bucket_prefix = "${var.service_name}-kb-"
}

output "voice_connector_outbound_host" {
  value       = aws_chime_voice_connector.tr_sip.outbound_host_name
  description = "Türk SIP sağlayıcınızın paneline yönlendireceğiniz AWS SIP adresi"
}

output "knowledge_bucket_name" {
  value = aws_s3_bucket.knowledge_and_logs.bucket
}

