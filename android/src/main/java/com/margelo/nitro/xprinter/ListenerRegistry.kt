package com.margelo.nitro.xprinter

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * Holds the listeners of a single event.
 *
 * Each listener is stored under its own id so that removing one subscription
 * never touches another caller's callback. Backed by a [ConcurrentHashMap], so
 * listeners can be added from the JS thread while events are emitted from the
 * main thread without locking.
 */
internal class ListenerRegistry<T : Any> {
  private val nextId = AtomicLong(0)
  private val listeners = ConcurrentHashMap<Long, T>()

  /**
   * Registers [listener] and returns the function that removes it again.
   * The returned function is idempotent.
   */
  fun add(listener: T): () -> Unit {
    val id = nextId.getAndIncrement()
    listeners[id] = listener
    return { listeners.remove(id) }
  }

  /**
   * Invokes [action] for every currently registered listener.
   *
   * Iteration runs over a weakly consistent snapshot: a listener removed while
   * an emission is in flight may still be called once more.
   */
  fun forEach(action: (T) -> Unit) {
    listeners.values.forEach(action)
  }

  fun clear() {
    listeners.clear()
  }
}
