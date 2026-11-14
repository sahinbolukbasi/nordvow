import type { LegalBody, LegalDocId } from "./types";

const p = (text: string) => ({ p: text });
const ul = (items: string[]) => ({ ul: items });
const ol = (items: string[]) => ({ ol: items });

/** İngilizce sürüm bilgilendirme içindir. Bağlayıcı metin Türkçedir. */
export const PACK_EN: Record<LegalDocId, LegalBody> = {
  terms: {
    title: "Platform Terms of Use",
    intro: "These terms govern use of the Nordvow platform by agencies (Admin and Agency roles), brands and influencers. By using the platform you accept them. Mandatory consumer-protection rules prevail where you act as a consumer. The Turkish text is binding.",
    sections: [
      { id: "tanim", title: "Definitions and status", blocks: [ul([
        "Nordvow: [Şirket unvanı], owner and operator of the platform.",
        "Platform: the software for campaigns, offers, content, payouts, messaging, events, coupons and creative AI.",
        "Agency / Admin: the agency and its staff. The agency is liable for its users’ acts.",
        "Brand: the business collaborating with influencers.",
        "Influencer: the person or entity creating content. Commercial influencers may be merchants.",
        "User: any account holder.",
        "Content: text, image, video, audio, briefs, comments and AI output uploaded or generated on the platform.",
      ]), p("Nordvow is a software intermediary. It is not a party to, nor a guarantor of, the brand–influencer contract unless a separate written agreement says so. Nordvow’s status as an intermediary service provider under Turkish Law No. 5651 is reserved; Nordvow is not obliged to pre-screen user content.")] },
      { id: "hesap", title: "Account, age and security", blocks: [ul([
        "Membership opens by invitation and Nordvow’s approval. Nordvow may refuse an application without stating reasons.",
        "The platform is not for anyone under 18. Work with a minor requires guardian consent and agency responsibility.",
        "You must keep your details accurate and your credentials safe. You are responsible for use until you notify Nordvow of compromise.",
        "Nordvow may suspend or close an account for risk, law, non-payment, suspected abuse or breach, subject to proportionality and mandatory consumer rules.",
      ])] },
      { id: "hizmet", title: "No guarantee of results", blocks: [
        p("The platform is provided “as is” and “as available”. Nordvow does not promise uninterrupted access, any level of reach, engagement, sales, brand awareness or campaign profit, or any outcome of Meta, TikTok or Google policies. Scores, recommendations and AI output are decision support only."),
        p("Changes, limits or shutdowns of third-party APIs are not Nordvow’s default."),
      ] },
      { id: "fikri", title: "Intellectual property and licence", blocks: [
        p("The software, interface, brand and database right belong to Nordvow. You receive a non-exclusive, non-transferable right to use the platform during the contract."),
        p("You warrant that you own or are licensed to upload your content. You grant Nordvow a worldwide, royalty-free, transferable, sublicensable, non-exclusive licence of economic rights to host, secure, back up, run the relevant campaign, report on it and promote Nordvow and that campaign. The licence lasts for the account and a reasonable archive period. Content already published may be kept as needed for historical reports."),
        p("Moral rights under Turkish copyright law are not assigned. Nordvow may make technical changes required for format, crop, captions and platform delivery."),
      ] },
      { id: "ai", title: "Creative AI", blocks: [ul([
        "Outputs are probabilistic. Nordvow does not warrant accuracy, originality, non-infringement or fitness for a purpose.",
        "You must review outputs before publication against law, advertising rules and third-party rights.",
        "Generation of a real person’s identity may be refused. The filter is not guaranteed to catch every case.",
        "fal.ai, Amazon Bedrock and similar providers have their own terms. Nordvow is not liable for their models, outages or training data.",
        "An “AI generated” label does not remove your disclosure duties.",
      ])] },
      { id: "influencer", title: "Influencer duties", blocks: [ul([
        "Paid or gifted posts must show, from the first moment, that they are ads under Article 23/A of the Commercial Advertising Regulation, Advertising Board practice, and the platform’s paid-partnership label.",
        "No misleading health, income or product claims. Honour exclusivity and competitor bans.",
        "Keep the content live for the agreed period. Early deletion may forfeit fees.",
        "The influencer terms at /influencer-sozlesmesi form part of this contract.",
      ])] },
      { id: "marka", title: "Brand duties", blocks: [ul([
        "Briefs, products, prices and claims must be accurate. The brand holds the permits needed to market the product.",
        "Brand assets licensed to creators are owned or properly licensed by the brand.",
        "Approval deadlines and payment plans must be met. Delay may suspend work and accrue default interest.",
        "The brand complies with Law No. 6563, IYS and Meta rules on WhatsApp, Instagram and similar channels.",
        "The brand terms at /marka-sozlesmesi form part of this contract.",
      ])] },
      { id: "odeme", title: "Fees, tax, refunds, chargebacks and set-off", blocks: [ul([
        "Fees and commissions are those shown on the platform or in the offer. Taxes are extra unless stated otherwise.",
        "Withholding notices are information, not tax advice. Filing remains the taxpayer’s duty.",
        "An influencer fee becomes payable when the work is completed under the rules and any hold period has ended. Nordvow is not obliged to pay an influencer a sum it has not collected from the brand, unless a written guarantee says otherwise.",
        "Outside consumer sales, refunds are made only if the law requires them or Nordvow agrees in writing. Used credits, completed AI jobs and started campaigns are not refunded.",
        "Chargebacks are passed to the brand or the buyer. Nordvow may set off the amount, its commission and bank costs against sums it owes.",
        "Nordvow may set off mutual debts by unilateral notice, subject to the Turkish Code of Obligations.",
      ]), p("Consumer tickets and coupons follow Law No. 6502, the Distance Contracts Regulation, and the pages /mesafeli-satis and /iade-iptal.")] },
      { id: "sona", title: "Suspension and termination", blocks: [p("Nordvow may terminate immediately for serious breach, illegality, fraud, security risk or a lawful order, and otherwise on notice. Fees for work already done and Nordvow’s commission survive. Termination does not erase accrued debts or clauses on confidentiality, IP, indemnity or evidence.")] },
      { id: "sorumluluk", title: "Limitation of liability", blocks: [
        p("Nordvow’s aggregate liability is capped at the fees that user actually paid to Nordvow in the twelve months before the claim. If none were paid, liability for direct loss is capped at one thousand Turkish lira. Indirect loss, lost profit, lost data, reputational harm and sanctions of third-party platforms are excluded."),
        p("The cap does not apply to wilful misconduct or gross negligence, or to bodily injury where the law forbids a cap (Turkish Code of Obligations art. 115). In consumer contracts the cap applies only so far as it is not an unfair term under Law No. 6502. Mandatory consumer rules prevail."),
      ] },
      { id: "tazminat", title: "Indemnity", blocks: [p("You will indemnify Nordvow against third-party claims, administrative fines and reasonable legal fees arising from your content, advertising, Article 23/A breaches, commercial messages sent without IYS consent, IP or data-protection breaches, or harm you cause the other campaign party, except to the extent caused by Nordvow’s wilful misconduct or gross negligence.")] },
      { id: "mucbir", title: "Force majeure", blocks: [p("Natural disaster, war, terror, epidemic, widespread cyberattack, backbone or power failure, cloud or model-provider outage, API or policy changes by Meta, TikTok or Google, and acts of public authorities, if beyond Nordvow’s reasonable control, are not default. Affected duties are suspended while the obstacle lasts.")] },
      { id: "degisiklik", title: "Unilateral changes", blocks: [p("Nordvow may change these terms and fees. A material change adverse to you is notified by e-mail or in-app at least fifteen days before it takes effect. Continued use is acceptance. You may close the account before the effective date; accrued debts remain. A change that is an unfair term against a consumer is not applied.")] },
      { id: "hukuk", title: "Law and venue", blocks: [p("Turkish law applies. For merchants and users acting for a commercial purpose, the courts of Istanbul (Çağlayan) and the Istanbul enforcement offices have jurisdiction. A consumer does not lose the right to apply to the consumer arbitration committee and consumer court of their place of residence.")] },
      { id: "delil", title: "Evidence agreement", blocks: [p("Under article 193 of the Turkish Civil Procedure Code, Nordvow’s books, electronic logs, transaction records, acceptance records and system extracts are conclusive evidence. The contrary may be proved only by evidence of equal strength. Against a consumer this clause applies only as far as the law allows a conclusive-evidence agreement.")] },
      { id: "tebligat", title: "Notices", blocks: [p("Notices are sent to the e-mail on the account and in-app. E-mail is deemed received on the next business day unless it bounces. You must keep your e-mail current.")] },
      { id: "bolunebilirlik", title: "Severability, assignment and entire agreement", blocks: [ul([
        "If a clause is invalid, the rest stands. The invalid clause is replaced by the valid clause closest to its purpose.",
        "Nordvow may assign this contract to an affiliate or a successor. You may not assign it without Nordvow’s written consent.",
        "This contract, the role terms, published fees and your acceptance record form the whole agreement. For non-consumer deals the order is: the specific campaign contract, the role terms, then these platform terms.",
      ])] },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    intro: "This policy explains in plain language what personal data Nordvow processes and why. The full Article 10 notice is the KVKK clarification text at /kvkk-aydinlatma. If they differ, the clarification text and mandatory law prevail. The Turkish text is binding.",
    sections: [
      { id: "rol", title: "Controller and processor", blocks: [p("For accounts, security, billing and running the platform, Nordvow is the controller. For a brand’s own customer messages on WhatsApp, Instagram or Messenger, and for recipient lists the brand uploads, the brand is generally the controller and Nordvow is the processor, acting on the brand’s instructions, this policy and the contract.")] },
      { id: "kategori", title: "Categories", blocks: [ul([
        "Identity and contact: name, e-mail, phone, tax number, company details.",
        "Security: password hash, session, IP, browser, cookies, audit log.",
        "Profile: category, city, rates, social handles, audience metrics, IBAN and tax profile.",
        "Campaign: briefs, offers, content, metrics, scores, chat.",
        "Messaging: content, phone numbers and delivery status on Meta channels the brand connects.",
        "Payments and events: tickets, coupons, payout requests.",
        "AI: prompts, reference files and outputs.",
      ])] },
      { id: "amac", title: "Purposes and legal bases", blocks: [p("Data is processed to perform the contract (KVKK art. 5/2-c), to meet legal duties (art. 5/2-ç, tax and commercial-message law), to establish or protect a right (art. 5/2-e) and for legitimate interests (art. 5/2-f: security, fraud prevention and service improvement, balanced against your interests). Marketing, non-mandatory transfers abroad and optional AI processing rely on separate explicit consent (/acik-riza). Special-category data is not requested; do not upload it.")] },
      { id: "meta", title: "Meta, WhatsApp and Instagram", blocks: [
        p("As required by the Meta Platform Terms: if you connect Facebook, Instagram, Messenger or WhatsApp, Nordvow may process account and page ids, handles, profile information, message content, delivery and read status, ad-referral data and webhook events. The purpose is the inbox, campaign and customer correspondence, compliance with commercial-message law, and abuse prevention."),
        p("This data is not sold, not shared with data brokers, and not used to build advertising profiles on non-Meta networks. Meta’s own policy applies to processing on Meta’s systems. You may disconnect the account in Meta’s settings or in Nordvow. Disconnection does not erase records still within a legal retention period. Meta’s data-deletion flow is handled at /veri-silme and /api/meta/data-deletion."),
      ] },
      { id: "aktarim", title: "Sharing and transfers abroad", blocks: [
        p("Data may be shared with the brand, agency or influencer in a collaboration, payment and e-mail providers, hosting providers, auditors and public authorities where the law requires it. Hosting is primarily AWS in Frankfurt. Meta (Ireland and the United States), fal.ai and Amazon Bedrock may process data abroad."),
        p("Transfers abroad follow KVKK art. 9 as amended by Law No. 7499 in 2024: an adequacy decision, appropriate safeguards (standard contracts, binding corporate rules or undertakings) or a statutory exception. Standard contracts are notified to the Personal Data Protection Board. Where the transfer is not required to perform the contract, explicit consent is asked separately."),
      ] },
      { id: "sure", title: "Retention", blocks: [p("Account data is kept for the membership and a reasonable limitation period; financial records for tax-law periods; message content for the brand’s period, default ninety days; audit logs for the dispute period; cookies as stated in the cookie policy. Data is then deleted, anonymised or archived.")] },
      { id: "hak", title: "Rights and requests", blocks: [p("KVKK art. 11 rights are listed at /kvkk-aydinlatma. Apply to [KVKK başvuru e-postası] or [KEP adresi]. Meta-originated deletion requests also follow /veri-silme.")] },
    ],
  },
  kvkk: {
    title: "KVKK Clarification Text",
    intro: "Prepared under Article 10 of Law No. 6698 and the Communiqué on Procedures and Principles for Fulfilment of the Obligation to Inform. This text informs you. It is not explicit consent and consent is not bundled into the contract. The Turkish text is binding.",
    sections: [
      { id: "sorumlu", title: "Identity of the controller", blocks: [p("The controller is [Şirket unvanı], identified in the company block. Requests go to [KVKK başvuru e-postası] and [KEP adresi].")] },
      { id: "amac-hukuki", title: "Purposes and legal bases", blocks: [ul([
        "Membership, authentication, contract and support: art. 5/2-c.",
        "Invoices, withholding information, commercial books and retention: art. 5/2-ç and, where applicable, art. 5/2-a.",
        "Fraud, security, disputes and evidence: art. 5/2-e and art. 5/2-f.",
        "Logs and cookies strictly necessary to run the service: art. 5/2-c or art. 5/2-f.",
        "Marketing, non-mandatory transfers abroad and optional AI features: explicit consent under art. 5/1. Refusing consent does not by itself block membership.",
      ])] },
      { id: "toplama", title: "Collection method", blocks: [p("Data is collected wholly or partly by automated means through the sign-up form, invitations, the panel, cookies, Meta webhooks, payment notices and support messages.")] },
      { id: "aktarim", title: "Recipients", blocks: [p("Data is transferred among the brand, agency and influencer as needed to perform the work, and to AWS, fal.ai, Amazon Bedrock, Meta (WhatsApp, Instagram, Messenger), payment and e-mail infrastructure, and competent public authorities. Purposes are limited to those in the privacy policy.")] },
      { id: "yurtdisi", title: "Transfers abroad", blocks: [p("Article 9 of the KVKK was amended on 12 March 2024 by Law No. 7499. A transfer relies on an adequacy decision, appropriate safeguards (standard contract, binding corporate rules or a written undertaking) or a statutory exception. Standard contracts are notified to the Board. AWS Frankfurt is in the European Economic Area. Transfers to Meta, fal.ai and Bedrock use those safeguards or explicit consent.")] },
      { id: "haklar", title: "Rights under Article 11", blocks: [ul([
        "Learn whether data is processed and, if so, request information.",
        "Learn the purpose and whether processing matches that purpose.",
        "Know the third parties to whom data is transferred in Turkey or abroad.",
        "Request correction of incomplete or inaccurate data and notification of that correction to recipients.",
        "Request erasure or destruction under Article 7.",
        "Object to a result to your detriment reached solely by automated analysis.",
        "Claim compensation if you suffer damage from unlawful processing.",
      ]), p("Requests follow the Communiqué. Nordvow answers as soon as possible and within thirty days. A fee from the Board’s tariff may be charged if the operation has a separate cost. You may complain to the Board if the answer is insufficient.")] },
    ],
  },
  consent: {
    title: "Explicit Consent",
    intro: "This consent is optional. If you do not tick the box, processing that is necessary to perform the contract continues. You may withdraw consent at any time without giving a reason. Withdrawal does not undo processing that was lawful before withdrawal. The Turkish text is binding.",
    sections: [
      { id: "konu", title: "What you consent to", blocks: [ul([
        "Commercial electronic messages are covered separately by /ileti-izni. This consent does not replace that approval.",
        "Transfer of your personal data to Meta, fal.ai and Amazon Bedrock abroad, to the extent the transfer is not already required to perform the contract or to meet a legal duty.",
        "Processing of your prompt and uploaded file by those providers when you use optional AI features such as briefs, copy, images or video.",
        "Use of usage data that cannot be fully anonymised to improve the product. Fully anonymous statistics do not need consent.",
      ])] },
      { id: "ozgurluk", title: "Free will", blocks: [p("Consent is not a condition of the contract, is not taken by a pre-ticked box, and is not hidden inside the clarification text. Withdraw it by writing to [KVKK başvuru e-postası]. Optional processing then stops. Statutory retention remains.")] },
    ],
  },
  cookies: {
    title: "Cookie Policy",
    intro: "This policy follows the Turkish Personal Data Protection Board’s guidance on cookies and Law No. 6698. A cookie is a small text file stored on your browser. Similar local storage may be used. The Turkish text is binding.",
    sections: [
      { id: "tur", title: "Types", blocks: [ul([
        "Strictly necessary: session (authjs.session-token), security (authjs.csrf-token), post-login return (authjs.callback-url), logout flag (nv_logout), language and country (nv_locale, nv_country) and the cookie choice itself. The legal basis is KVKK art. 5/2-c or 5/2-f. They are required for sign-in and security. Consent is not requested.",
        "Functional: theme (infl-theme) and an assistant draft kept for the tab session. They are not essential. You are asked on the first visit. If you refuse, the default theme is used.",
        "Analytics, advertising and third-party tracking cookies are not used. If they are added later, this policy will change and separate explicit consent will be asked, with no pre-ticked box.",
      ])] },
      { id: "sure", title: "Durations", blocks: [ul([
        "Session cookies: the browser session or at most twelve hours.",
        "Language, country and cookie choice: at most one year.",
        "Theme: at most one year.",
      ])] },
      { id: "yonetim", title: "Your choices", blocks: [p("You can refuse non-essential cookies in the cookie banner. You can also delete or block cookies in the browser. Blocking necessary cookies may stop you signing in. Cookies of other sites follow those sites’ policies.")] },
    ],
  },
  deletion: {
    title: "Data deletion",
    intro: "You may ask Nordvow to delete personal data in your account or received through Meta (Facebook, Instagram, WhatsApp, Messenger). Copies on Meta’s own systems must be deleted with Meta’s tools. The Turkish text is binding.",
    sections: [
      { id: "adim", title: "How to ask", blocks: [ol([
        "E-mail [KVKK başvuru e-postası] or root@nordvow.com with the subject “Veri silme”. Include your account e-mail and, if you have it, your Meta user id.",
        "Meta’s “delete my data” flow sends a signed request to /api/meta/data-deletion. Nordvow verifies the signature with META_APP_SECRET and returns a confirmation code and a link to this page.",
        "Open this page with that code to see whether the request was received.",
      ])] },
      { id: "surec", title: "What is deleted and what is kept", blocks: [p("Profile, message and content data that Nordvow is not legally required to keep is deleted or anonymised within thirty days. Tax, invoice, audit and dispute records may be kept for the statutory period. Deletion does not cancel debts between a brand and an influencer.")] },
      { id: "meta", title: "Meta channels", blocks: [p("Webhook messages, connection tokens and related contact records are in scope. Deleting them from Nordvow does not delete Meta’s own copies.")] },
    ],
  },
  influencer: {
    title: "Influencer Terms",
    intro: "These terms are part of the Platform Terms. On influencer-specific points they prevail for non-consumer deals. The Turkish text is binding.",
    sections: [
      { id: "ifa", title: "Performance", blocks: [p("Accepting an offer means you will deliver the platform, format, date, tags and banned phrases in the brief. You publish on the agreed date and keep the content live for the agreed period. Nordvow does not guarantee the brand’s or your performance.")] },
      { id: "reklam", title: "Ad disclosure", blocks: [p("Every paid or gifted post must be recognisable as an ad at first glance under Article 23/A, Advertising Board practice, and the platform paid-partnership label. Misleading health, income or “works for everyone” claims are forbidden. Breach may mean rejection, removal and forfeiture of fees. Administrative fines generally fall on the advertiser, the medium and the creator. Nordvow does not assume those fines.")] },
      { id: "ucret", title: "Fees", blocks: [p("The fee is the amount in the offer. Nordvow’s commission is shown separately. Payment depends on compliant completion, any hold period and a usable tax profile. You are responsible for a wrong IBAN or tax detail. Early deletion or a missing label may reduce the fee proportionally.")] },
      { id: "lisans", title: "Rights granted to the brand", blocks: [p("Unless the offer says otherwise, the brand may use the content on the agreed channels during the campaign and for the agreed period afterwards, within the fee. Extending the term or the channels needs a new fee. Nordvow’s platform licence is reserved.")] },
    ],
  },
  brand: {
    title: "Brand Terms",
    intro: "These terms are part of the Platform Terms. On brand-specific points they prevail for non-consumer deals. The Turkish text is binding.",
    sections: [
      { id: "brief", title: "Brief and product", blocks: [p("The brand warrants that the brief, product claims and price are accurate and that it holds the permits needed to market the product. Extra production and third-party claims caused by a wrong brief are the brand’s.")] },
      { id: "odeme", title: "Payment", blocks: [p("The brand pays accepted offers and Nordvow’s commission when due. Nordvow may suspend the service and claim statutory default interest. Chargebacks are passed back to the brand.")] },
      { id: "iletisim", title: "Commercial messages and Meta", blocks: [p("Before messaging its own customers the brand must hold consent that satisfies Law No. 6563 and IYS. A technical block in Nordvow does not remove the brand’s legal liability. Meta sanctions are not Nordvow’s debt.")] },
      { id: "hak", title: "Brand assets", blocks: [p("The brand warrants that it owns, or can sublicense, its logo, product images and copy. If that is untrue, the brand indemnifies Nordvow.")] },
    ],
  },
  distance: {
    title: "Distance Sales Contract",
    intro: "This contract applies when Nordvow sells an event ticket, coupon, gift voucher or digital credit to a consumer at a distance, under Law No. 6502 and the Distance Contracts Regulation. A commercial collaboration between a brand and an influencer is outside this contract. The Turkish text is binding.",
    sections: [
      { id: "taraf", title: "Parties and subject", blocks: [p("The seller is Nordvow ([Şirket unvanı], [Merkez adresi], [Destek e-postası], [Telefon], [MERSİS numarası]). The buyer is the consumer who places the order. The subject is the ticket, coupon or digital service shown at checkout. The total price, including taxes, is confirmed before payment.")] },
      { id: "ifa", title: "Performance", blocks: [p("An electronic ticket or coupon is delivered to your account or e-mail without undue delay after payment is approved, and within the statutory period. The date, place and time of an event are in the order summary.")] },
      { id: "cayma", title: "Right of withdrawal and the exception", blocks: [
        p("The statutory period is fourteen days. Under article 15/1-g of the Distance Contracts Regulation there is no right of withdrawal for contracts for leisure activities to be performed on a specific date or within a specific period. A ticket for a dated event falls under that exception. Transfer of the ticket follows the event rules."),
        p("An unused coupon or gift voucher may be withdrawn within fourteen days of delivery. A code that has been used, transferred, or whose performance has started with your consent may no longer be withdrawn. If performance of a digital credit has begun with your express consent and your acknowledgement that you lose the right of withdrawal, that right cannot be used."),
        p("Withdraw by a clear statement to [Destek e-postası]. The price is refunded within fourteen days of Nordvow receiving the statement, by a means consistent with the original payment. Any amount that cannot legally be refunded is shown separately."),
      ] },
      { id: "uyusmazlik", title: "Disputes", blocks: [p("A consumer may apply to the consumer arbitration committee and the consumer court of their place of residence or of where the transaction was made. Monetary thresholds follow the annual tariff.")] },
    ],
  },
  refund: {
    title: "Returns and cancellation",
    intro: "This page explains refunds and cancellation for tickets, coupons and digital credits bought at a distance. Commercial campaign fees follow the refund rule in the Platform Terms. The Turkish text is binding.",
    sections: [
      { id: "bilet", title: "Event tickets", blocks: [p("A ticket for a specific date has no statutory right of withdrawal. If Nordvow or the organiser cancels the event, the price of an unused ticket is refunded to the original payment method. Not attending, a ticket already transferred in time, or a breach of event rules is not a ground for a refund. If the event is postponed, the ticket remains valid for the new date; if you cannot attend the new date and you say so, the price is refunded.")] },
      { id: "kupon", title: "Coupons and gift vouchers", blocks: [p("An unused coupon may be returned within fourteen days of delivery. A code that is partly or fully used, expired, or personal to a campaign whose performance has started is not refunded unless the law requires it. If Nordvow’s fault means the code was never delivered, the full price is refunded.")] },
      { id: "kredi", title: "Digital credit", blocks: [p("Unused credit is refunded if the withdrawal conditions are met. Spent generation, an opened hold and amounts already incurred as third-party model cost are not refunded. A duplicate charge caused by Nordvow is corrected.")] },
      { id: "usul", title: "How to ask", blocks: [p("Write to [Destek e-postası] with the order number and the account e-mail. An approved refund is sent to the same payment method within fourteen days. The bank’s posting time is not part of Nordvow’s period.")] },
    ],
  },
  iys: {
    title: "Commercial electronic message consent",
    intro: "Under Law No. 6563 and the Regulation on Commercial Communication and Commercial Electronic Messages, commercial electronic messages need a separate approval. It is not hidden inside acceptance of the contract and it is not pre-ticked. Refusing it does not stop you using the platform. The Turkish text is binding.",
    sections: [
      { id: "kapsam", title: "Who may send what", blocks: [p("If you approve, Nordvow may send campaign news, product and service information and surveys by e-mail, SMS, call and WhatsApp. Each message identifies the sender and how to opt out. Service messages required to perform the contract (password, invoice, security, contract notices) do not depend on this approval.")] },
      { id: "iys", title: "IYS and opt-out", blocks: [p("Your approval is recorded in the Message Management System (İYS), and your right to opt out remains. You may opt out through İYS, through the method in the message, or by writing to [Destek e-postası]. Nordvow processes the opt-out within three business days of receiving it. An opt-out does not undo earlier lawful messages.")] },
      { id: "sure", title: "Duration", blocks: [p("The approval lasts until you withdraw it. Nordvow keeps the record for the period the law requires.")] },
    ],
  },
};
