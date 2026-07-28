import type { SupportTelegramReceiptStatus } from "../../types/support";

export type TelegramReceiptPresentation = {
    icon: string;
    label: "Sending" | "Sent" | "Received" | "Failed";
    title: string;
};

export function telegramReceiptPresentation(
    status: SupportTelegramReceiptStatus,
    deliveryStatus = "",
    receivedAtLabel?: string,
): TelegramReceiptPresentation {
    if (status === "parent_replied") {
        return {
            icon: "\u2713\u2713",
            label: "Received",
            title: receivedAtLabel
                ? `The parent sent a later message at ${receivedAtLabel}, confirming that this message was received.`
                : "A later parent message confirms that this message was received.",
        };
    }
    if (status === "sent") {
        return {
            icon: "\u2713",
            label: "Sent",
            title: "Telegram accepted the message.",
        };
    }
    if (status === "sending") {
        return {
            icon: "...",
            label: "Sending",
            title: "The message is waiting to be sent to Telegram.",
        };
    }
    return {
        icon: "!",
        label: "Failed",
        title: deliveryStatus.toLowerCase() === "blocked"
            ? "Telegram could not deliver this because the parent blocked the bot."
            : "Telegram did not confirm that this message was sent.",
    };
}
