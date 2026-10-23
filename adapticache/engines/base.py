"""Pieces shared by every engine: the physical frame table and the step record.

Every engine emits one record per reference in the same shape, so the collector and
the front end never need to know which algorithm produced a trace (Review 1, Module 2).
"""


class FrameTable:
    """Physical page frames.

    A page keeps the slot it was loaded into until it is evicted, and the incoming page
    takes the victim's slot. This makes the trace read like the classic textbook table
    where each row is one frame.
    """

    def __init__(self, size):
        self.slots = [None] * size
        self.where = {}

    def load(self, page, victim=None):
        """Place `page` in a free slot, or in the slot `victim` occupied. Returns the slot."""
        if victim is None:
            slot = self.slots.index(None)
        else:
            slot = self.where.pop(victim)
        self.slots[slot] = page
        self.where[page] = slot
        return slot

    def slot_of(self, page):
        return self.where[page]

    def snapshot(self):
        return list(self.slots)

    def __contains__(self, page):
        return page in self.where

    def __len__(self):
        return len(self.where)

    @property
    def full(self):
        return len(self.where) == len(self.slots)


def make_step(t, page, hit, table, evicted=None, slot=None, note="", **extra):
    """One row of the uniform trace. `t` is 0-based; notes speak in 1-based steps."""
    record = {
        "t": t,
        "page": page,
        "hit": hit,
        "frames": table.snapshot(),
        "evicted": evicted,
        "slot": slot,
        "note": note,
    }
    record.update(extra)
    return record
