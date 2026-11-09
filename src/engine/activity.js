// Activities: what an actor is doing right now (move, attack, harvest...).
//
// Each actor has a current activity with an optional chain of `next` activities (the queue)
// and each activity can run `child` activities first. tick() returns true when finished.
// cancel() asks the activity to finish as soon as possible and drops the queued ones.

export class Activity {
  constructor() {
    this.state = 0; // 0 queued, 1 running, 2 done
    this.child = null;
    this.next = null;
    this.canceling = false;
  }

  run(self) {
    if (this.state === 0) { this.state = 1; if (this.onFirstRun) this.onFirstRun(self); }
    while (this.child) {
      if (!this.child.run(self)) return false;
      this.child = this.child.next;
    }
    const done = this.tick(self);
    if (done) { this.state = 2; if (this.onLastRun) this.onLastRun(self); }
    return done;
  }

  tick() { return true; }

  queueChild(act) {
    if (!this.child) { this.child = act; return; }
    let a = this.child;
    while (a.next) a = a.next;
    a.next = act;
  }

  cancel(self, keepQueue = false) {
    if (this.state === 2) return;
    this.canceling = true;
    if (this.child) this.child.cancel(self);
    if (!keepQueue) this.next = null;
  }

  // For UI/debug: a short label describing the activity chain.
  get label() { return this.child ? this.child.label : this.constructor.label || this.constructor.name; }
}

export class Wait extends Activity {
  constructor(ticks) { super(); this.ticks = ticks; }
  tick() { return this.canceling || --this.ticks <= 0; }
}

export class CallFunc extends Activity {
  constructor(fn) { super(); this.fn = fn; }
  tick(self) { if (!this.canceling) this.fn(self); return true; }
}
