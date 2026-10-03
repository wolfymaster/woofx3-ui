//! Reconnect delays:
//! `ceiling = min(max, initial * 2^attempt)`, jittered into
//! `[ceiling / 2, ceiling]` so companions that lost the relay together do not
//! reconnect together.

use std::time::Duration;

use rand::Rng;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Backoff {
    pub initial: Duration,
    pub max: Duration,
}

impl Default for Backoff {
    fn default() -> Self {
        Backoff {
            initial: Duration::from_secs(1),
            max: Duration::from_secs(60),
        }
    }
}

impl Backoff {
    /// The upper bound of the delay before retry number `attempt` (0-based).
    pub fn ceiling(&self, attempt: u32) -> Duration {
        // 2^31 seconds is far past any sensible max, so the shift saturates
        // there instead of overflowing.
        let factor = 1u32 << attempt.min(31);
        self.initial.saturating_mul(factor).min(self.max)
    }

    /// `jitter` is in `[0, 1]`: 0 gives half the ceiling, 1 the whole ceiling.
    pub fn delay_with_jitter(&self, attempt: u32, jitter: f64) -> Duration {
        assert!(
            (0.0..=1.0).contains(&jitter),
            "jitter {jitter} is outside [0, 1]"
        );
        let ceiling = self.ceiling(attempt);
        let half = ceiling / 2;
        half + (ceiling - half).mul_f64(jitter)
    }

    pub fn delay(&self, attempt: u32) -> Duration {
        self.delay_with_jitter(attempt, rand::rng().random_range(0.0..=1.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ceiling_doubles_from_initial_up_to_max() {
        let backoff = Backoff::default();
        assert_eq!(backoff.ceiling(0), Duration::from_secs(1));
        assert_eq!(backoff.ceiling(1), Duration::from_secs(2));
        assert_eq!(backoff.ceiling(5), Duration::from_secs(32));
        assert_eq!(backoff.ceiling(6), Duration::from_secs(60));
        assert_eq!(backoff.ceiling(40), Duration::from_secs(60));
        assert_eq!(backoff.ceiling(u32::MAX), Duration::from_secs(60));
    }

    #[test]
    fn jitter_spans_half_the_ceiling_to_the_ceiling() {
        let backoff = Backoff::default();
        assert_eq!(backoff.delay_with_jitter(3, 0.0), Duration::from_secs(4));
        assert_eq!(backoff.delay_with_jitter(3, 1.0), Duration::from_secs(8));
        assert_eq!(backoff.delay_with_jitter(3, 0.5), Duration::from_secs(6));
    }

    #[test]
    fn random_delays_stay_in_bounds() {
        let backoff = Backoff::default();
        for attempt in 0..12 {
            let ceiling = backoff.ceiling(attempt);
            for _ in 0..200 {
                let delay = backoff.delay(attempt);
                assert!(
                    delay >= ceiling / 2 && delay <= ceiling,
                    "{delay:?} for attempt {attempt}"
                );
            }
        }
    }

    #[test]
    #[should_panic]
    fn refuses_jitter_outside_the_unit_interval() {
        Backoff::default().delay_with_jitter(0, 1.5);
    }
}
