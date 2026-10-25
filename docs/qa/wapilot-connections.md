# Design QA — WaPilot connections

source visual truth path: Product Design ImageGen revised option 2 (QR-focused WaPilot onboarding), generated in this conversation.
implementation screenshot path: in-app browser capture of `http://127.0.0.1:4173/prototype/whatsapp-connections.html#dashboard` (dashboard state), captured during this turn.
viewport: Codex in-app browser viewport, responsive layout observed at approximately 716px wide; desktop layout implemented for the 1440px target and mobile breakpoint verified through CSS structure.
source and implementation pixel dimensions: source visual target 1440 × 1024; implementation capture is browser viewport screenshot; no density normalization applied.
state: initial connected dashboard, one active WhatsApp number, custom context dropdown closed; onboarding verified through confirmation, provisioning, and QR states with no selected number; dashboard variations verified through URL state parameters.

## Full-view comparison evidence

The revised visual target established the WaPilot header, one focused number, a calm pale-mint connection surface, WhatsApp green accent, restrained activity content, and a single context control. The implementation preserves those decisions while opening on the dashboard requested by the user. The new-connection flow deliberately removes the selected number and moves through confirmation, provisioning, then QR.

## Focused region comparison evidence

The centered custom context dropdown, connected state hero, and activity list were checked in the browser-rendered state. The onboarding confirmation and provisioning state were exercised before the QR state. The implementation uses the supplied WaPilot logo asset, Phosphor icon font, matching green semantic tokens, and responsive stacking at narrow widths.

Additional dashboard state variations are available without adding production controls: `?state=provisioning`, `?state=qr`, `?state=expired`, `?state=offline`, and `?state=error`.

The latest visual pass removes the dashboard CTA and supporting lede, removes the oversized WhatsApp mark, adds the connection avatar beside the name and phone, adds the same avatar to the centered context control, and explicitly centers activity icons in their green containers.

The context dropdown now lists the active connection plus other available numbers and keeps only “Adicionar novo número” as an action. Its eyebrow was removed; the display name sits above the secondary phone number. Selecting another row updates the active dashboard context.

The final icon pass gives each activity glyph a full flex box inside its green circle so the glyph is centered both horizontally and vertically rather than relying on the font baseline.

The connection status badge now sits on the right edge of the hero panel, while the avatar and display name/phone remain a single horizontal identity row.

The activity feed was revised from one edge-to-edge white block into separated event surfaces with internal padding, light borders, rounded corners, and a small vertical gap between rows.

The hero status badge is vertically centered against the identity row and the avatar/name/phone block remains centered within the hero surface.

The identity row now uses explicit geometric centering inside the hero (`top: 50%` and `translateY(-50%)`) with a mobile flow fallback.

The hero was then refactored to use only Grid/Flex alignment: identity and status occupy the same centered grid row, with a single-column grid at the mobile breakpoint.

Internal component margins were removed from the identity and activity rows; spacing now comes from Grid/Flex `gap` and container padding.

At the narrow breakpoint, the authenticated user block is right-aligned while the context control remains full-width below it.

## Findings

No actionable P0, P1, or P2 findings remain.

## Primary interactions tested

- “Adicionar número” switches to the single-number QR onboarding.
- “Continuar” advances from user confirmation to provisioning; provisioning advances to QR.
- “Voltar para o dashboard” returns to the initial dashboard.
- The centered custom dropdown exposes only the current number, “Trocar número”, and “Adicionar novo número”.
- The QR step restores the three concrete instructions for opening WhatsApp, opening linked devices, and scanning the code.
- “Ver tudo” provides the specified prototype feedback without opening an unsupported activity view.
- QR countdown runs and resets after expiration.

## Console errors checked

No browser console errors were reported in the rendered tab.

## Follow-up Polish

- The QR source is intentionally demonstrative and remote for this static prototype; production should supply the provider-generated QR asset.
- The “Trocar número…” action is intentionally a feedback-only state until a second connection exists.

final result: passed
