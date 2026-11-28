# Message write operations in Evolution Go and Whatsmeow

This audit covers public HTTP writes in Evolution Go and user-facing mutations available through the Whatsmeow client. It includes adjacent conversation and administrative operations to establish the boundary of the proposed WaPilot tool. The evidence comes from source inspection. Availability on a running deployment and behavior on linked devices require separate verification.

- Evolution Go main was [`1dd78ce35d105e8ee61c3e842f5297c2fd070f3e`][evo]. Its [go.mod][dep] pins Whatsmeow [`307a2edf117da3cb1e5e672332c06969c75a54e9`][sdk].
- Whatsmeow main was [`3fe87b230cba979d8c5ebbcc23d22b75952d55c3`][sdk-main] at review time. The [comparison][sdk-diff] includes receipt handling, poll option key handling and send changes. The inventory below uses the dependency pin because it is the code Evolution Go builds against.

## Writes that target existing messages

All routes in the table use the instance token. Request examples describe the existing flat JSON fields. The middleware can translate JSON:API requests and rewrites responses even when the input is flat JSON. [Router][routes] · [Request translation][request] · [Response encoding][encode]

| Action | Whatsmeow at the dependency pin | Evolution Go at the audited commit |
| --- | --- | --- |
| Edit text | `BuildEdit` and `SendMessage`. The protocol key identifies a self-authored message. Verify the applicable time limit against the service and real devices. [Edit builder][edit] | `POST /message/edit` with `{chat,messageId,message}`. Sends extended text. The handler checks presence of fields and the service builds the operation directly. The response ID identifies the edit action. [Handler][message-handler] · [Service][edit-service] |
| Edit a media caption | `BuildEdit` accepts a replacement protobuf message. The builder alone establishes neither caption eligibility nor how to preserve media and quote context. [Edit builder][edit] | No caption write. The edit route is text-only and the router marks media editing as a TODO. [Router][routes] |
| Delete for everyone | `BuildRevoke` and `SendMessage`. Empty or own sender targets one's own message. A group admin can target another sender using that person's JID. [Revoke builder][revoke] | `POST /message/delete` with `{chat,messageId}`. Always passes an empty sender, so the route builds an own-message revoke. The response ID identifies the revoke action. The returned timestamp comes from an unassigned variable. [Handler][message-handler] · [Service][edit-service] |
| Delete for me | App-state schema and incoming event handling exist. The pin has no dedicated outbound builder. [App-state indexes][keys] · [Incoming app state][state-receive] | No route. Would need a compatible outbound patch, device sync verification, and a decision on visibility in retained history. [Router][routes] |
| Mark read | `MarkRead` sends a receipt. Batch IDs must share a chat and, in groups, the original sender. SDK privacy settings can change the outgoing receipt to `read-self`. [Receipt sender][receipt] | `POST /message/markread` with `{number,id: string[]}`. The service uses the chat JID for both the chat and sender, producing an incorrect group participant. The JSON:API request and response mappings model a single ID. [Service][receipt-service] · [Request translation][request] · [Response encoding][receipt-encode] |
| Mark voice message played | The same SDK method with `ReceiptTypePlayed`. [Receipt sender][receipt] | `POST /message/markplayed` with the same fields and group sender issue. The handler checks for IDs and a number. The service does not look up the message type. Both legacy receipt services return zero timestamps. [Handler][message-handler] · [Service][receipt-service] |
| Add, replace, or remove a reaction | `BuildReaction` and `SendMessage` for ordinary chats. Empty reaction text removes the account's reaction. Channels use a separate SDK method. [Reaction builder][revoke] · [Channel methods][newsletter] | `POST /message/react` with `{number,id,reaction,fromMe,participant?}`. Use `"remove"` to clear the reaction. The service builds the target key from caller input, allocates a fresh action ID and can persist the sent reaction. [Handler][message-handler] · [Service][react] |
| Label or unlabel one message | `appstate.BuildLabelMessage` and `SendAppState`. [Patch builders][patches] | `POST /label/message` and `POST /unlabel/message` with `{jid,labelId,messageId}`. Verify label availability and linked-device sync on an eligible account. [Router][routes] · [Label service][labels] |
| Star or unstar | `appstate.BuildStar` and `SendAppState`. The patch uses chat, sender, direction and target ID. [Star builder][star] | No route. Add a typed operation with verified target identity and test sync with a linked device. [Router][routes] |
| Pin or unpin a message for the chat | The SDK has `PinInChatMessage` wire types and a send classification. There is no dedicated builder in the pinned SDK. [Wire types][wire] · [Send classification][send-types] | No message pin route. The `/chat/pin` pair pins conversations in the chat list. [Router][routes] |
| Keep or undo keep for a disappearing message | The SDK has `KeepInChatMessage` wire types and classifies one undo case on send. [Wire types][wire] · [Send classification][send-types] | No route. Needs protocol and permission verification before an adapter can promise the operation. [Router][routes] |
| Vote, change a vote, or clear a vote | `BuildPollVote` and `SendMessage`. The builder hashes option names, encrypts the vote and requires original poll metadata and its stored secret. An empty selection can be encoded. Verify clearing on real clients. [Poll vote builder][secret] | Poll creation is a send. The result and vote routes are reads. Add a write with validated choices, selection limits and a distinct missing-secret error. [Router][routes] |
| Edit a poll, add a poll option, edit or cancel an event, or schedule an existing message | The wire schema recognizes these update families. That establishes wire or receive support. A dedicated outbound builder for these actions was not found. [Wire types][wire] · [Secret message handling][secret] | No matching write routes. The inbound decoder identifies these subtypes and marks them unsupported for projection. [Router][routes] · [Secret update decoder][decode] |
| RSVP to an event | The SDK recognizes and decrypts encrypted event responses. A public outbound RSVP builder was not found at the dependency pin. [Secret message handling][secret] | Event creation is a send. Event responses are readable. A write requires an outbound implementation and an observed round trip. [Router][routes] |
| View or react to a channel post | `NewsletterMarkViewed` and `NewsletterSendReaction` use channel server message IDs. Encrypted comments and reactions also have separate SDK helpers that require the original message secret. [Channel methods][newsletter] · [Secret message handling][secret] | Routes exist to read channel messages and manage subscriptions. No channel-specific viewed or reaction write is registered. Treat channel and Status message identities as distinct cases for testing. [Router][routes] |

In JSON:API responses, edit and revoke action IDs appear in `meta.result.messageId`. The reaction response also uses `meta.result`. The legacy read route can synthesize an empty receipt ID when the request is flat JSON because the encoder takes the ID from JSON:API `data.id`. [Response encoding][encode] · [Receipt response][receipt-encode]

The text edit and revoke services parse the caller's chat and send immediately. They lack the explicit JID canonicalization used by the reaction and receipt paths and have no retained-target verification. The edit repository has an existing transaction for decoded inbound encrypted edits. The explicit edit endpoint does not call it. A revocation action can appear in history as a protocol action. This audit found no corresponding retained-original tombstone in the revoke route or message repository. Verify edit and revoke read-back before claiming that history reflects the action. [Edit/revoke service][edit-service] · [JID helpers][jid] · [Edit projection][projection] · [History action encoding][history-action]

App-state writes have a separate ambiguity. `SendAppState` can return an error while fetching app state after sending the patch. The SDK also handles an explicit patch-version conflict with its own recovery. Treat an ambiguous failure as an unknown result at the HTTP and MCP layers. [App-state send][state-send]

## Other write operations

| Target | Evolution Go route inventory | Whatsmeow capabilities and gaps |
| --- | --- | --- |
| Conversation | `POST /chat/{pin,unpin,archive,unarchive,mute,unmute,history-sync}`, `POST /message/presence`, `POST /label/chat`, `POST /unlabel/chat`. Router marks the six pin/archive/mute routes as not working. Current mute lasts one hour. | Chat pin, archive, mute, read/unread, labels and delete-chat app-state builders. Clear-chat schema and receive support. `SetDisappearingTimer`, typing/recording presence, history sync and unavailable-message peer requests. Marking a chat unread changes its chat-list state. It cannot retract an already-sent read receipt. [Router][routes] · [Chat service][chat-service] · [App-state builders][patches] · [Incoming app state][state-receive] · [Presence][presence] · [Send and peer helpers][send] |
| Contacts, profile, privacy, labels | `POST /user/{block,unblock,profilePicture,profileName,profileStatus,privacy}`, and `POST /label/edit` to create, edit, or delete a label definition. | Blocklist changes, privacy settings, default disappearing timer, profile updates where supported, contact QR link rotation and label definition patches. WaPilot already has its own contact tool. [Router][routes] · [User service][user-service] · [User methods][user] · [Privacy][privacy] · [App-state builders][patches] |
| Groups and communities | `POST /group/{photo,name,description,create,participant,join,leave,settings,invitelink}` (invite link resets when requested). `POST /community/{create,add,remove}`. | Create, join, leave, change photo/name/topic/description, change participant membership or roles, review participant requests, change announcement/lock/join approval/member-add settings, reset invite links, and link or unlink community groups. [Router][routes] · [Group service][group-service] · [Group methods][group] |
| Channels and calls | `POST /newsletter/{create,subscribe}` and `POST /call/reject`. The subscribe route requests live updates. | Channel creation, follow, unfollow, mute, live-update subscription, and terms notice acceptance. Reject a call. [Router][routes] · [Channel methods][newsletter] · [Call methods][call] |
| Session and server administration | Instance create/delete, proxy set/delete, forced reconnect, connect/pair/disconnect/reconnect/logout, advanced settings and admin presence. `GET /instance/qr` can start a client to obtain a QR. Webhook endpoint create/update/delete, credential rotation, test delivery and replay. Passkey ceremony response and confirmation. | Connection lifecycle, pairing, passkey response/confirmation, logout, presence, push registration and transport configuration. Webhook and instance management are Evolution Go application operations. [Router][routes] · [Webhook routes][webhooks] · [Passkey routes][passkey] · [QR service][qr] · [Client][client] · [Pairing][pair] · [Push registration][push] |
| New message or publication | `POST /send/{text,link,media,event,poll,sticker,location,contact,button,list,template,carousel,status/text,status/media}`. | `SendMessage`, alternate Messenger transport, media upload, standalone media-object deletion, and channel publishing support. Media-object deletion is distinct from deleting a message. A reply, forward, comment, or Status post creates a new message even when it references an existing one. [Router][routes] · [Send][send] · [Messenger send][sendfb] · [Media][upload] |

The inventory treats POST lookups such as `/message/status`, `/message/downloadmedia`, `/user/check`, `/group/info`, and `/newsletter/messages` as reads. The loopback webhook receiver and automatic protocol acknowledgments are implementation operations. The audit excludes database maintenance, SDK store setters and raw node methods as user actions. [Router][routes] · [Receipt sender][receipt]

[evo]: https://github.com/neurau/evolution-go/commit/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e
[dep]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/go.mod#L26
[sdk]: https://github.com/tulir/whatsmeow/commit/307a2edf117da3cb1e5e672332c06969c75a54e9
[sdk-main]: https://github.com/tulir/whatsmeow/commit/3fe87b230cba979d8c5ebbcc23d22b75952d55c3
[sdk-diff]: https://github.com/tulir/whatsmeow/compare/307a2edf117da3cb1e5e672332c06969c75a54e9...3fe87b230cba979d8c5ebbcc23d22b75952d55c3
[routes]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/routes/routes.go
[request]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/jsonapi/request.go#L13-L47
[encode]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/jsonapi/encode.go#L925-L982
[receipt-encode]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/jsonapi/encode.go#L1299-L1320
[message-handler]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/message/handler/message_handler.go
[edit-service]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/message/service/message_service.go#L527-L586
[receipt-service]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/message/service/message_service.go#L322-L374
[react]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/message/service/message_service.go#L143-L230
[labels]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/label/service/label_service.go
[decode]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/whatsmeow/service/secret_encrypted.go#L25-L79
[jid]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/utils/utils.go#L191-L230
[projection]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/message/repository/message_edit.go
[history-action]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/jsonapi/encode.go#L725-L812
[chat-service]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/chat/service/chat_service.go
[user-service]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/user/service/user_service.go
[group-service]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/group/service/group_service.go
[webhooks]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/events/webhook/handler.go#L69-L243
[passkey]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/passkey/handler/passkey_handler.go#L172-L183
[edit]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/send.go#L607-L633
[revoke]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/send.go#L510-L558
[send]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/send.go
[receipt]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/receipt.go#L187-L237
[newsletter]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/newsletter.go
[patches]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/appstate/encode.go
[star]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/appstate/encode.go#L245-L261
[keys]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/appstate/keys.go
[state-receive]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/appstate.go#L307-L361
[state-send]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/appstate.go#L553-L647
[wire]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/proto/waE2E/WAWebProtobufsE2E.proto
[send-types]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/send.go#L1053-L1086
[secret]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/msgsecret.go
[presence]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/presence.go
[user]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/user.go
[privacy]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/privacysettings.go
[group]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/group.go
[call]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/call.go
[client]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/client.go
[pair]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/pair-code.go
[sendfb]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/sendfb.go
[upload]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/upload.go
[qr]: https://github.com/neurau/evolution-go/blob/1dd78ce35d105e8ee61c3e842f5297c2fd070f3e/pkg/instance/service/instance_service.go#L458-L490
[push]: https://github.com/tulir/whatsmeow/blob/307a2edf117da3cb1e5e672332c06969c75a54e9/push.go#L97
