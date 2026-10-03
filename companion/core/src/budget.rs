//! Byte budgets for a stream's queues. The queues are bounded in messages
//! too, but a message can be up to 1 MiB, so a count alone would let one
//! stream buffer hundreds of megabytes.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

/// The bytes one direction of one stream may have queued at once.
#[derive(Clone, Debug)]
pub(crate) struct ByteBudget {
    used: Arc<AtomicUsize>,
    limit: usize,
}

impl ByteBudget {
    pub fn new(limit: usize) -> Self {
        ByteBudget {
            used: Arc::new(AtomicUsize::new(0)),
            limit,
        }
    }

    /// Takes `bytes` from the budget until the returned charge is dropped, or
    /// returns None when that would exceed the limit.
    pub fn charge(&self, bytes: usize) -> Option<Charge> {
        let limit = self.limit;
        self.used
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |used| {
                used.checked_add(bytes).filter(|total| *total <= limit)
            })
            .ok()?;
        Some(Charge {
            used: Arc::clone(&self.used),
            bytes,
        })
    }
}

/// Bytes held against a budget while their message waits in a queue.
#[derive(Debug)]
pub(crate) struct Charge {
    used: Arc<AtomicUsize>,
    bytes: usize,
}

impl Drop for Charge {
    fn drop(&mut self) {
        self.used.fetch_sub(self.bytes, Ordering::AcqRel);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_what_would_exceed_the_limit_until_charges_are_released() {
        let budget = ByteBudget::new(10);
        let first = budget.charge(6).expect("fits");
        assert!(budget.charge(5).is_none());
        let second = budget.charge(4).expect("fits exactly");
        drop(first);
        let third = budget
            .charge(6)
            .expect("released bytes are available again");
        drop((second, third));
        assert!(budget.charge(11).is_none(), "never more than the limit");
        assert!(budget.charge(10).is_some());
    }
}
