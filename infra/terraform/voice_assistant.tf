# AI Sesli Asistan Altyapısı (Amazon Connect + Kinesis Video Streams + Bedrock KB + ECS Fargate)
# Mevcut canlı dağıtımı etkilememek için `enable_voice_assistant = false` varsayılanıyla gelir;
# açmak için terraform.tfvars içine `enable_voice_assistant = true` ekleyin.

variable "enable_voice_assistant" {
  type        = bool
  default     = false
  description = "Amazon Connect, Chime SIP Trunk (+90), KVS, Bedrock KB ve Voice Gateway altyapısını etkinleştir"
}

variable "enable_chime_sip" {
  type        = bool
  default     = false
  description = "AWS Chime SDK Voice Connector'ı etkinleştir (AWS hesabında Chime Voice izni açıldığında true yapın)"
}

variable "voice_sip_origination_cidrs" {
  type        = list(string)
  default     = ["185.0.0.0/27"]
  description = "Türk VoIP/SIP sağlayıcınızın (Netgsm, Bulutfon, Kobikom vb.) SIP sunucu IP blokları (/27 - /32 arası)"
}

# Türkiye (+90) SIP Trunk bağlamak için Amazon Chime SDK Voice Connector
resource "aws_chime_voice_connector" "tr_sip" {
  count              = var.enable_voice_assistant && var.enable_chime_sip ? 1 : 0
  name               = "${local.name}-tr-sip"
  require_encryption = true
  aws_region         = var.region
}

resource "aws_chime_voice_connector_termination" "tr_termination" {
  count              = var.enable_voice_assistant && var.enable_chime_sip ? 1 : 0
  voice_connector_id = aws_chime_voice_connector.tr_sip[0].id
  cps_limit          = 2
  calling_regions    = ["TR"]
  cidr_allow_list    = var.voice_sip_origination_cidrs
}

# Canlı ses akışı (WebSocket /ws/call) için ALB hedef grubu ve kuralı
resource "aws_lb_target_group" "voice_ws" {
  count                = var.enable_voice_assistant ? 1 : 0
  name                 = "${local.name}-voice-ws"
  port                 = 4100
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 15

  health_check {
    path                = "/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener_rule" "voice_ws" {
  count        = var.enable_voice_assistant ? 1 : 0
  listener_arn = aws_lb_listener.http.arn
  priority     = 50

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.voice_ws[0].arn
  }

  condition {
    path_pattern {
      values = ["/ws/call", "/ws/call/*"]
    }
  }
}

resource "aws_kinesis_video_stream" "voice_stream" {
  count                   = var.enable_voice_assistant ? 1 : 0
  name                    = "${var.project}-voice-stream"
  data_retention_in_hours = 24
  media_type              = "audio/L16"
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
  description = "Nordvow gelen çağrı karşılama ve Türkçe Lex V2 AI sesli asistan akışı."
  content = jsonencode({
    Version     = "2019-10-30"
    StartAction = "enable-logs"
    Metadata = {
      entryPointPosition = { x = 40, y = 40 }
      ActionMetadata = {
        enable-logs = { position = { x = 140, y = 40 } }
        set-voice   = { position = { x = 300, y = 40 } }
        lex-bot     = { position = { x = 500, y = 40 } }
        err-msg     = { position = { x = 500, y = 240 } }
        disconnect  = { position = { x = 760, y = 40 } }
      }
    }
    Actions = [
      {
        Identifier = "enable-logs"
        Type       = "UpdateFlowLoggingBehavior"
        Parameters = {
          FlowLoggingBehavior = "Enabled"
        }
        Transitions = {
          NextAction = "set-lang"
        }
      },
      {
        Identifier = "set-lang"
        Type       = "UpdateContactData"
        Parameters = {
          LanguageCode = "tr-TR"
        }
        Transitions = {
          NextAction = "set-voice"
          Errors = [
            { NextAction = "set-voice", ErrorType = "NoMatchingError" }
          ]
        }
      },
      {
        Identifier = "set-voice"
        Type       = "UpdateContactTextToSpeechVoice"
        Parameters = {
          TextToSpeechVoice  = "Burcu"
          TextToSpeechEngine = "Neural"
          TextToSpeechStyle  = "None"
        }
        Transitions = {
          NextAction = "lex-bot"
          Errors = [
            { NextAction = "lex-bot", ErrorType = "NoMatchingError" }
          ]
        }
      },
      {
        Identifier = "lex-bot"
        Type       = "ConnectParticipantWithLexBot"
        Parameters = {
          Text = "Merhaba, Nordvow'a hoş geldiniz. Buyurun, nasıl yardımcı olabilirim?"
          LexV2Bot = {
            AliasArn = "arn:aws:lex:${var.region}:${local.account_id}:bot-alias/PMSDD4F3RY/YN9QNN08SS"
          }
          LexSessionAttributes = {
            calledPhone = "$.SystemEndpoint.Address"
            callerPhone = "$.CustomerEndpoint.Address"
          }
        }
        Transitions = {
          NextAction = "disconnect"
          Errors = [
            { NextAction = "disconnect", ErrorType = "NoMatchingCondition" },
            { NextAction = "err-msg", ErrorType = "NoMatchingError" }
          ]
        }
      },
      {
        Identifier = "err-msg"
        Type       = "MessageParticipant"
        Parameters = {
          Text = "Şu anda sesli asistan bağlantısında teknik bir sorun oluştu, lütfen daha sonra tekrar deneyin."
        }
        Transitions = {
          NextAction = "disconnect"
          Errors = [
            { NextAction = "disconnect", ErrorType = "NoMatchingError" }
          ]
        }
      },
      {
        Identifier  = "disconnect"
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

output "voice_sip_outbound_host" {
  value       = var.enable_voice_assistant && var.enable_chime_sip ? aws_chime_voice_connector.tr_sip[0].outbound_host_name : null
  description = "Türk SIP sağlayıcınızın paneline yönlendireceğiniz AWS Chime SIP adresi"
}

