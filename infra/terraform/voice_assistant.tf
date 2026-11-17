# AI Sesli Asistan Altyapısı (Amazon Connect + Kinesis Video Streams + Bedrock KB + ECS Fargate)
# Mevcut canlı dağıtımı etkilememek için `enable_voice_assistant = false` varsayılanıyla gelir;
# açmak için terraform.tfvars içine `enable_voice_assistant = true` ekleyin.

variable "enable_voice_assistant" {
  type        = bool
  default     = false
  description = "Amazon Connect, KVS, Bedrock KB ve Voice Gateway altyapısını etkinleştir"
}

resource "aws_kinesis_video_stream" "voice_stream" {
  count                   = var.enable_voice_assistant ? 1 : 0
  name                    = "${var.project}-voice-stream"
  data_retention_in_hours = 24
  media_type              = "audio/L16;rate=8000;channels=1"
}

resource "aws_sqs_queue" "voice_kb_ingestion" {
  count                     = var.enable_voice_assistant ? 1 : 0
  name                      = "${var.project}-voice-kb-ingestion"
  visibility_timeout_seconds = 120
  message_retention_seconds = 86400
}

resource "aws_connect_instance" "voice" {
  count                    = var.enable_voice_assistant ? 1 : 0
  identity_management_type = "CONNECT_MANAGED"
  inbound_calls_enabled    = true
  outbound_calls_enabled   = true
  instance_alias           = "${var.project}-voice"
}

resource "aws_iam_role" "voice_gateway" {
  count              = var.enable_voice_assistant ? 1 : 0
  name               = "${var.project}-voice-gateway"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "voice_gateway_policy" {
  count = var.enable_voice_assistant ? 1 : 0
  name  = "${var.project}-voice-gateway-policy"
  role  = aws_iam_role.voice_gateway[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:Retrieve",
          "bedrock:StartIngestionJob"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "transcribe:StartStreamTranscription",
          "polly:SynthesizeSpeech",
          "textract:DetectDocumentText"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "kinesisvideo:GetDataEndpoint",
          "kinesisvideo:GetMedia"
        ]
        Resource = aws_kinesis_video_stream.voice_stream[0].arn
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.assets.arn,
          "${aws_s3_bucket.assets.arn}/voice-kb/*",
          "${aws_s3_bucket.assets.arn}/voice-cache/*"
        ]
      }
    ]
  })
}

resource "aws_connect_contact_flow" "ai_assistant_flow" {
  count       = var.enable_voice_assistant ? 1 : 0
  instance_id = aws_connect_instance.voice[0].id
  name        = "Nordvow AI Sesli Asistan Akışı"
  type        = "CONTACT_FLOW"
  description = "Gelen aramada Start Media Streaming (KVS) başlatır, yapay zekâ yanıtlarını oynatır ve gerekirse kuyruğa/harici numaraya aktarır."
  content = jsonencode({
    Version = "2019-10-30"
    StartAction = "start-streaming"
    Actions = [
      {
        Identifier = "start-streaming"
        Type       = "StartMediaStreaming"
        Parameters = {
          MediaStreamingState = "Enabled"
          Participants = [
            { ParticipantType = "Customer", MediaDirections = ["From", "To"] }
          ]
        }
        Transitions = {
          NextAction = "transfer-or-end"
        }
      },
      {
        Identifier  = "transfer-or-end"
        Type        = "DisconnectParticipant"
        Parameters  = {}
        Transitions = {}
      }
    ]
  })
}

output "voice_connect_instance_id" {
  value = var.enable_voice_assistant ? aws_connect_instance.voice[0].id : null
}

output "voice_kvs_stream_arn" {
  value = var.enable_voice_assistant ? aws_kinesis_video_stream.voice_stream[0].arn : null
}

