export type RankingsRequestGuard = {
  nextRequestId: () => number;
  cancelOutstanding: () => void;
  isCurrent: (requestId: number) => boolean;
};

export function createRankingsRequestGuard(initialRequestId = 0): RankingsRequestGuard {
  let activeRequestId = initialRequestId;

  return {
    nextRequestId() {
      activeRequestId += 1;
      return activeRequestId;
    },
    cancelOutstanding() {
      activeRequestId += 1;
    },
    isCurrent(requestId: number) {
      return activeRequestId === requestId;
    },
  };
}
