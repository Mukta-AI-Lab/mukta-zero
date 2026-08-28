# Mukta Zero - Privacy Notice

Version 1.0 - 25 August 2026

**Controller for the Mukta-controlled surfaces described below:** Mukta Soluções em Informática Ltda. (CNPJ 45.919.531/0001-10, Brazil), operating as “Mukta AI Lab” (“Mukta”).

## Short Version

**Mukta Zero itself does not send telemetry or usage data to Mukta.** Data can nevertheless flow to third parties that you configure, and Mukta may process limited personal data when you interact with Mukta-controlled public surfaces or support/payment channels.

## Layer 1 - Mukta Zero on Your Infrastructure

Mukta Zero is designed to run on infrastructure you control.

- Mukta does not require a Mukta account for the Software itself.
- Mukta Zero does not intentionally send usage analytics, prompts, code, results, logs, or crash reports to Mukta.
- Local session state, logs, caches, and other files remain in the environment where you run the Software, subject to your own configuration.

If a future version introduces telemetry, this notice and the relevant release documentation must be updated before that feature is enabled.

## Layer 2 - Data Flows You Configure

Mukta Zero can send prompts, code, context, or other data to model providers and services that **you** configure using your own credentials.

For those flows:

- you decide which provider receives data and what data is sent;
- the provider’s role as processor, independent controller, or other legal role depends on your agreement and applicable law;
- Mukta does not receive that data merely because Mukta Zero is used; and
- you are responsible for selecting an appropriate legal basis, notices, contracts, security measures, and data-minimization controls for your use.

If you point Mukta Zero at repositories, files, databases, or systems containing personal or confidential data, you are responsible for having the right to process that information.

## Layer 3 - Mukta-Controlled Public Surfaces

### GitHub

If you interact with the Mukta Zero repository through GitHub, GitHub processes account, connection, and interaction data under its own terms and privacy documentation. Information you intentionally post in public issues, discussions, commits, or pull requests may be publicly visible.

Mukta may access and use information you submit to the project for repository administration, security, contribution review, support, and community management.

### support.mukta.app and Infrastructure

Mukta’s support page may be delivered through third-party infrastructure providers such as Cloudflare. Those providers may process technical connection metadata such as IP address, timestamps, and user-agent information as part of providing and securing the service.

Mukta does not intend to operate first-party behavioral advertising or analytics on the support page unless this notice is updated accordingly.

### Voluntary Support Payments / Stripe

Where payments are processed by Stripe, payment-card credentials are handled by Stripe and are not intended to be received directly by Mukta. Mukta may receive transaction metadata and contact information made available by Stripe, such as payment amount, date, payer name, and e-mail address, for receipts, accounting, fraud prevention, reconciliation, and legal obligations.

Mukta retains such records only for as long as reasonably necessary for those purposes and applicable legal/accounting retention obligations.

## Legal Bases

Where the LGPD applies and Mukta acts as controller, processing may rely on performance of a contract or requested action, compliance with legal or regulatory obligations, legitimate interests balanced against data-subject rights, exercise of legal rights, or consent where consent is appropriate.

Where the GDPR or another privacy law applies, the corresponding legal basis will be assessed under that law.

## Your Rights

Where applicable law gives you data-subject rights and Mukta is the controller, you may request confirmation of processing, access, correction, deletion or anonymization where legally available, portability where applicable, information about sharing, and review of other rights provided by applicable law.

Requests: `licensing@mukta.app` with subject “Mukta Zero privacy request”.

You may also lodge a complaint with the competent data-protection authority, including the ANPD in Brazil where applicable.

## Security

Mukta uses reasonable administrative and technical measures for personal data under its control. No internet service or storage system is guaranteed to be completely secure.

## Changes

Material updates to this notice will be published in the repository with an updated version/date.
