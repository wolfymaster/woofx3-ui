//! Wall-clock time for logic that schedules against it, injected so tests
//! drive time by hand instead of waiting.
//!
//! Times are milliseconds since the Unix epoch, the unit the window shows
//! them in. A sleep is measured from the moment it starts, so a wall-clock
//! jump while it waits shifts when it ends; every caller re-reads the time
//! after waking and waits again if it woke early.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use futures::future::BoxFuture;

/// Milliseconds since the Unix epoch.
pub type EpochMillis = u64;

pub trait Clock: Send + Sync {
    fn now(&self) -> EpochMillis;

    /// Resolves once [`Clock::now`] has reached `deadline`, or at once when
    /// it already has.
    fn sleep_until(&self, deadline: EpochMillis) -> BoxFuture<'static, ()>;
}

/// The OS clock, sleeping on the tokio timer.
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> EpochMillis {
        // A clock set before 1970 reads as the epoch rather than failing:
        // schedules then run early, which is harmless.
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| {
                u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
            })
    }

    fn sleep_until(&self, deadline: EpochMillis) -> BoxFuture<'static, ()> {
        let wait = Duration::from_millis(deadline.saturating_sub(self.now()));
        Box::pin(tokio::time::sleep(wait))
    }
}

/// Milliseconds in `duration`, saturating, for arithmetic on [`EpochMillis`].
pub fn millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

/// A clock that moves only when a test moves it, and reports each sleep it
/// is asked for so the test knows what the code under test waits on.
#[cfg(test)]
pub(crate) mod fake {
    use tokio::sync::{mpsc, watch};

    use super::*;

    pub struct FakeClock {
        now: watch::Sender<EpochMillis>,
        sleeps: mpsc::UnboundedSender<EpochMillis>,
    }

    impl FakeClock {
        /// The clock at `start`, and the deadline of every sleep asked of it.
        pub fn new(start: EpochMillis) -> (Self, mpsc::UnboundedReceiver<EpochMillis>) {
            let (sleeps, asked) = mpsc::unbounded_channel();
            let clock = FakeClock {
                now: watch::Sender::new(start),
                sleeps,
            };
            (clock, asked)
        }

        pub fn set(&self, at: EpochMillis) {
            assert!(
                at >= *self.now.borrow(),
                "the fake clock only moves forward"
            );
            self.now.send_replace(at);
        }
    }

    impl Clock for FakeClock {
        fn now(&self) -> EpochMillis {
            *self.now.borrow()
        }

        fn sleep_until(&self, deadline: EpochMillis) -> BoxFuture<'static, ()> {
            // The receiver may be gone in a test that does not watch sleeps.
            let _unwatched = self.sleeps.send(deadline);
            let mut now = self.now.subscribe();
            Box::pin(async move {
                // The sender lives as long as the clock, which outlives
                // every sleep in a test; a dropped one ends the sleep.
                let _ = now.wait_for(|now| *now >= deadline).await;
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::FakeClock;
    use super::*;

    #[tokio::test]
    async fn test_fake_clock_sleep_ends_when_the_clock_reaches_the_deadline() {
        let (clock, mut sleeps) = FakeClock::new(1_000);
        let sleep = tokio::spawn(clock.sleep_until(5_000));
        assert_eq!(sleeps.recv().await, Some(5_000));
        clock.set(4_999);
        tokio::task::yield_now().await;
        assert!(!sleep.is_finished());
        clock.set(5_000);
        sleep.await.expect("the sleep ends");
    }

    #[tokio::test]
    async fn test_system_clock_sleep_until_the_past_ends_at_once() {
        let clock = SystemClock;
        let started = std::time::Instant::now();
        clock.sleep_until(clock.now().saturating_sub(10_000)).await;
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn test_millis_saturates() {
        assert_eq!(millis(Duration::from_secs(2)), 2_000);
        assert_eq!(millis(Duration::MAX), u64::MAX);
    }
}
