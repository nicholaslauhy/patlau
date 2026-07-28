export const CHAT_BOTTOM_THRESHOLD_PX = 48;
export const CHAT_TOP_THRESHOLD_PX = 8;

type ChatScrollMetrics = {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
};

export function chatScrollEdges({
    scrollTop,
    scrollHeight,
    clientHeight,
}: ChatScrollMetrics) {
    const maximumScrollTop = Math.max(0, scrollHeight - clientHeight);
    const normalizedScrollTop = Math.min(
        maximumScrollTop,
        Math.max(0, scrollTop),
    );

    return {
        atTop: normalizedScrollTop <= CHAT_TOP_THRESHOLD_PX,
        atBottom:
            maximumScrollTop - normalizedScrollTop
            <= CHAT_BOTTOM_THRESHOLD_PX,
    };
}

export function countNewlyAppendedMessageIds(
    previousIds: readonly number[],
    currentIds: readonly number[],
) {
    if (
        previousIds.length === 0
        || currentIds.length <= previousIds.length
    ) {
        return 0;
    }
    for (let index = 0; index < previousIds.length; index += 1) {
        if (previousIds[index] !== currentIds[index]) return 0;
    }
    return currentIds.length - previousIds.length;
}
