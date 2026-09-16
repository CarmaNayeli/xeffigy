/**
 * The WebSocket message shape, matching mage.web.gateway.ClientCallbackTranslator on
 * the Java side: every server push becomes `{ type, objectId, data }`, where `type`
 * is the name() of a mage.interfaces.callback.ClientCallbackMethod enum constant and
 * `data` is whatever payload that method carries - shape depends on `type`, confirmed
 * against the real Java source (GameClientMessage/AbilityPickerView/ChoiceImpl), not
 * guessed.
 *
 * This file is intentionally not exhaustive over every ClientCallbackMethod - only
 * the ones the client actually needs to render something for. Unlisted types still
 * arrive and match the `GatewayEnvelope` fallback case; see gameReducer.ts.
 */

import type { CardsView, GameView } from "./gameView";

/** The ~35 push types the server can send - see ClientCallbackMethod.java for the full list. */
export type ClientCallbackMethodName =
  | "CHATMESSAGE"
  | "SHOW_USERMESSAGE"
  | "SERVER_MESSAGE"
  | "JOINED_TABLE"
  | "START_GAME"
  | "GAME_INIT"
  | "GAME_UPDATE_AND_INFORM"
  | "GAME_INFORM_PERSONAL"
  | "GAME_ERROR"
  | "GAME_UPDATE"
  | "GAME_TARGET"
  | "GAME_CHOOSE_ABILITY"
  | "GAME_CHOOSE_PILE"
  | "GAME_CHOOSE_CHOICE"
  | "GAME_ASK"
  | "GAME_SELECT"
  | "GAME_PLAY_MANA"
  | "GAME_PLAY_XMANA"
  | "GAME_GET_AMOUNT"
  | "GAME_GET_MULTI_AMOUNT"
  | "GAME_OVER"
  | "END_GAME_INFO"
  | "USER_REQUEST_DIALOG"
  | "GAME_REDRAW_GUI"
  /** Gateway-originated, not a real ClientCallbackMethod - see GatewaySession.sendGatewayError. */
  | "GATEWAY_ERROR"
  /** Gateway-originated - see GatewaySession.sendProgress. */
  | "GATEWAY_PROGRESS"
  /** Gateway-originated - see GatewaySession's "register"/"login"/"login_with_token". */
  | "ACCOUNT_LOGGED_IN"
  /** Gateway-originated - see GatewaySession's "logout". */
  | "ACCOUNT_LOGGED_OUT"
  /** Gateway-originated - see GatewaySession's "list_decks"/"save_deck"/"delete_deck". */
  | "ACCOUNT_DECKS"
  /** Gateway-originated - see GatewaySession's "load_deck". */
  | "ACCOUNT_DECK"
  /** Gateway-originated - see GatewaySession's "update_settings". */
  | "ACCOUNT_SETTINGS"
  /** Gateway-originated - see GatewaySession.sendAccountError. Deliberately separate
   * from GATEWAY_ERROR so a failed login doesn't flash in the pre-game "couldn't
   * connect" banner and vice versa. */
  | "ACCOUNT_ERROR";

export interface GatewayEnvelope<T = unknown> {
  type: ClientCallbackMethodName | string;
  objectId: string | null;
  data: T;
  /** Present only if ClientCallbackTranslator failed to serialize `data` for this callback. */
  serializationError?: string;
}

/**
 * mage.view.GameClientMessage - the payload for most dialog-shaped callbacks. Only a
 * subset of fields is populated per call site; see the comment on each
 * ClientCallbackMethodName usage in DialogPrompt.tsx for which ones matter where.
 */
export interface GameClientMessage {
  gameView?: GameView;
  /** GAME_CHOOSE_PILE: pile 1. GAME_TARGET: confirmed real (traced through
   * GameController.target -> GameSessionPlayer.target -> GameClientMessage's
   * (cardsView1, targets) constructor) - for a "search your library" style target
   * (TargetCardInLibrary: fetch lands, tutors, ...) this is the FULL, unfiltered pool
   * being searched (e.g. the player's entire library), not just the legal picks -
   * `targets` itself is null for this call site (see below), so this is where a
   * candidate's actual card data (name/art) has to come from instead. */
  cardsView1?: CardsView;
  /** GAME_CHOOSE_PILE: pile 2. */
  cardsView2?: CardsView;
  message?: string;
  /** GAME_TARGET: whether a target is required (false = a Cancel/pass response is valid). */
  flag?: boolean;
  /** GAME_TARGET/GAME_SELECT: legal UUIDs to pick from (Set<UUID> on the Java side) -
   * populated for a plain permanent/player target (Beast Within, "select a starting
   * player", ...). Confirmed NULL for a "search your library" style target
   * (TargetCardInLibrary) - GameController.target passes the Cards-event's own
   * `targets` straight through unchanged, and that event's constructor
   * (PlayerQueryEvent.targetEvent(Cards, ...)) hardcodes it to null. The real legal
   * ids for that case live in options.possibleTargets instead - see DialogPrompt.tsx's
   * GAME_TARGET case, which falls back to that field whenever this one is empty. */
  targets?: string[] | null;
  min?: number;
  max?: number;
  /** GAME_TARGET's "search your library" case (see targets/cardsView1 above) puts the
   * actual legal-to-pick ids here instead, as options.possibleTargets: string[]
   * (HumanPlayer.chooseTarget(Cards, ...) - `options.put("possibleTargets", ...)`,
   * only present at all when at least one legal target exists). */
  options?: Record<string, unknown> & { possibleTargets?: string[] };
  choice?: ChoiceView;
  messages?: MultiAmountMessage[];
}

/** mage.choices.ChoiceImpl's real fields (Gson serializes fields, not getters). */
export interface ChoiceView {
  message?: string;
  subMessage?: string;
  /** Plain string options - respond with one of these via send_string. */
  choices?: string[];
  /** Present instead of `choices` for key/label-style choices - respond with the key. */
  keyChoices?: Record<string, string>;
  specialEnabled?: boolean;
  specialText?: string;
}

export interface MultiAmountMessage {
  message?: string;
  min?: number;
  max?: number;
}

/** GAME_CHOOSE_ABILITY's payload - NOT wrapped in GameClientMessage, unlike the rest. */
export interface AbilityPickerPayload {
  /** ability/object id -> display label - respond with the chosen key via send_uuid. */
  choices: Record<string, string>;
  message?: string;
  gameView?: GameView;
}

export type DialogPayload = GameClientMessage | AbilityPickerPayload;

/** ACCOUNT_LOGGED_IN's payload (GatewaySession.handleAccountResult) - fires on a
 * successful register/login/login_with_token. */
export interface AccountLoggedIn {
  username: string;
  token: string;
  settings: AccountSettings;
}

/** Small, arbitrary per-account settings blob (AccountStore.defaultSettings) - only
 * tableTalk exists today, but the gateway doesn't validate contents, so this stays
 * open rather than a fixed shape. */
export interface AccountSettings {
  tableTalk?: boolean;
  [key: string]: unknown;
}

/** One entry in ACCOUNT_DECKS - just enough to list/pick a saved deck; the actual
 * content only comes down via ACCOUNT_DECK (load_deck), not the list itself. */
export interface AccountDeckSummary {
  name: string;
  format: string | null;
}

/** ACCOUNT_DECK's payload (a load_deck response). */
export interface AccountDeckContent {
  name: string;
  format: string | null;
  deck: string;
}
