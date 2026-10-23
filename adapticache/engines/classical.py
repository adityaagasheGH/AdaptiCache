"""Module 2: the three textbook baselines (FIFO, LRU, OPT)."""

from collections import OrderedDict, deque

from .base import FrameTable, make_step


def run_fifo(refs, frames):
    """Evict the page that has been resident the longest. Hits change nothing."""
    table = FrameTable(frames)
    queue = deque()
    loaded_at = {}
    steps = []
    for t, page in enumerate(refs):
        if page in table:
            steps.append(make_step(t, page, True, table, slot=table.slot_of(page),
                                   note=f"Hit. Page {page} is already in frame {table.slot_of(page)}. "
                                        "FIFO ignores hits, so its queue position does not change."))
            continue
        victim = None
        if table.full:
            victim = queue.popleft()
            note = (f"Fault. Evicted page {victim}, the oldest arrival (loaded at step "
                    f"{loaded_at.pop(victim) + 1}), even if it is still in use.")
        else:
            note = f"Fault. A frame is still free, so page {page} is loaded without evicting anything."
        slot = table.load(page, victim)
        queue.append(page)
        loaded_at[page] = t
        steps.append(make_step(t, page, False, table, evicted=victim, slot=slot, note=note))
    return steps


def run_lru(refs, frames):
    """Evict the page whose most recent use is furthest in the past."""
    table = FrameTable(frames)
    last_use = OrderedDict()  # least recently used first
    steps = []
    for t, page in enumerate(refs):
        if page in table:
            prev = last_use.pop(page)
            last_use[page] = t
            steps.append(make_step(t, page, True, table, slot=table.slot_of(page),
                                   note=f"Hit. Page {page} was last used at step {prev + 1}; "
                                        "it becomes the most recently used page."))
            continue
        victim = None
        if table.full:
            victim, used = last_use.popitem(last=False)
            note = (f"Fault. Evicted page {victim}, the least recently used page "
                    f"(last used at step {used + 1}).")
        else:
            note = f"Fault. A frame is still free, so page {page} is loaded without evicting anything."
        slot = table.load(page, victim)
        last_use[page] = t
        steps.append(make_step(t, page, False, table, evicted=victim, slot=slot, note=note))
    return steps


def next_use_table(refs):
    """nxt[t] = index of the next reference to refs[t] after t, or None if never used again."""
    nxt = [None] * len(refs)
    seen = {}
    for t in range(len(refs) - 1, -1, -1):
        nxt[t] = seen.get(refs[t])
        seen[refs[t]] = t
    return nxt


def run_opt(refs, frames):
    """Belady's optimal policy: evict the page whose next use is furthest in the future.

    Needs the whole future reference string, so it is a benchmark, not a real policy.
    Ties between pages that are never used again go to the one loaded earliest.
    """
    table = FrameTable(frames)
    nxt = next_use_table(refs)
    next_use = {}    # resident page -> index of its next reference (None = never again)
    loaded_at = {}
    steps = []
    for t, page in enumerate(refs):
        if page in table:
            next_use[page] = nxt[t]
            steps.append(make_step(t, page, True, table, slot=table.slot_of(page),
                                   note=f"Hit. Page {page} is resident; OPT kept it because it "
                                        "knew this reference was coming."))
            continue
        victim = None
        if table.full:
            never = [p for p in next_use if next_use[p] is None]
            if never:
                victim = min(never, key=lambda p: loaded_at[p])
                note = (f"Fault. Evicted page {victim}: it is never referenced again, "
                        "so removing it can never cause a future fault.")
            else:
                victim = max(next_use, key=lambda p: next_use[p])
                note = (f"Fault. Evicted page {victim}: of all resident pages, its next use "
                        f"(step {next_use[victim] + 1}) is furthest in the future.")
            del next_use[victim]
            del loaded_at[victim]
        else:
            note = f"Fault. A frame is still free, so page {page} is loaded without evicting anything."
        slot = table.load(page, victim)
        next_use[page] = nxt[t]
        loaded_at[page] = t
        steps.append(make_step(t, page, False, table, evicted=victim, slot=slot, note=note))
    return steps
