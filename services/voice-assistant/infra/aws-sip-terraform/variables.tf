variable "aws_region" {
  type        = string
  default     = "eu-central-1"
  description = "Türkiye'ye en yakın düşük gecikmeli AWS bölgesi (Frankfurt)"
}

variable "service_name" {
  type    = string
  default = "tr-voice-assistant"
}

variable "sip_origination_cidrs" {
  type        = list(string)
  default     = ["185.0.0.0/24"]
  description = "Türk VoIP/SIP sağlayıcınızın (Netgsm, Bulutfon vb.) SIP sunucu IP blokları"
}

