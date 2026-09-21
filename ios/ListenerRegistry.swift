import Foundation

/// Holds the listeners of a single event.
///
/// Each listener is stored under its own id so that removing one subscription
/// never touches another caller's callback. Backed by a lock rather than an
/// actor: callers add listeners and emit events from ordinary (non-async)
/// call sites, matching the Kotlin `ConcurrentHashMap` version's contract of
/// being safe to touch from any thread without `await`.
final class ListenerRegistry<T> {
  private let lock = NSLock()
  private var nextId: Int64 = 0
  private var listeners: [Int64: T] = [:]

  /// Registers `listener` and returns the function that removes it again.
  /// The returned function is idempotent.
  func add(_ listener: T) -> () -> Void {
    lock.lock()
    let id = nextId
    nextId += 1
    listeners[id] = listener
    lock.unlock()

    return { [weak self] in
      self?.lock.lock()
      self?.listeners.removeValue(forKey: id)
      self?.lock.unlock()
    }
  }

  /// Invokes `action` for every currently registered listener.
  ///
  /// Iteration runs over a snapshot taken under the lock: a listener removed
  /// while an emission is in flight may still be called once more.
  func forEach(_ action: (T) -> Void) {
    lock.lock()
    let snapshot = Array(listeners.values)
    lock.unlock()
    snapshot.forEach(action)
  }

  func clear() {
    lock.lock()
    listeners.removeAll()
    lock.unlock()
  }
}
