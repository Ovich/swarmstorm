# Decision points: Angular

## Contents

- A. Reactivity
- B. State and data flow
- C. Templates and components
- D. Forms
- E. Dependency injection
- F. Change detection and rendering
- G. Routing
- H. Testing
- Using this catalogue

The questions Angular forces inside the frontend tier, one level below
this skill's `decision-points.md`. Same contract: a catalogue of **questions, not rules**. A
project's answers go in that project's conventions file, in Angular's own vocabulary.

Each entry gives the question, why an unanswered version costs, **the tell** (what the
unresolved decision looks like in a repository), then three lines the stack catalogue
does not carry: *Judge it*, two sentences for someone who has never written Angular;
*Docs*, the angular.dev page it rests on and whether the page **answers** the question
(the interview confirms) or **leaves it open** (the interview asks).

Every entry was read against **Angular 22** (site footer v22.1.5), angular.dev only.
Angular 22 ships with three things already decided by the framework, and several
entries below exist only because of them: components are standalone, change detection
runs without zone.js, and `OnPush` is the default strategy.

`[forced]` = a first screen cannot be written without the answer; ask at bootstrap.
`[later]` = arrives with the first real occurrence; capture it then.

Vocabulary used throughout, defined once: a **signal** is a value holder that tells the
screen when its value changed; an **observable** is a stream of values over time that
code subscribes to; a **service** is a plain class Angular creates once and hands to
whoever asks for it; a **component** is one piece of screen with its own template.

---

## A. Reactivity

**1. Is a signal the default holder of state, and where may an observable still appear? `[forced]`**
Angular 22 has two reactive systems living side by side. Signals are what the docs
reach for first ("In Angular, you use signals to create and manage state"), but the
HTTP client still returns observables, and the interop layer (`toSignal`,
`toObservable`) exists precisely because both survive. Unanswered, every author picks
per file and the same value ends up held twice, once in each system, drifting.
*Tell:* a `BehaviorSubject` and a `signal` for the same piece of state; `toSignal`
called in several components on the same observable instead of once at the source;
`.subscribe()` inside a component with a manual unsubscribe.
*Judge it:* A signal is a box the screen watches; an observable is a pipe values flow
through, and you must remember to close it. The trade-off is uniformity versus reach:
one system everywhere is easier to read and test, but streams (server events, sockets,
typed HTTP) arrive as pipes, so the question is where the pipe is turned into a box.
*Docs:* https://angular.dev/essentials/signals · https://angular.dev/ecosystem/rxjs-interop ·
https://angular.dev/assets/context/best-practices.md ("Use signals for state
management", "Use the async pipe to handle observables"). Answers the default
(signals); **leaves open** the boundary where observables are allowed to appear.

**2. `computed()` or `linkedSignal()` for derived state, `effect()` for the outside world: is that the line? `[forced]`**
Angular states it flatly: "Always prefer `computed()` for derived values and
`linkedSignal()` for values that can be both derived and manually set", and "Avoid
using effects for propagation of state changes", which "can result in
`ExpressionChangedAfterItHasBeenChecked` errors, infinite circular updates, or
unnecessary change detection cycles". Effects are for logging, storage sync, custom
DOM, canvas and third-party UI: "syncing signal state to imperative, non-signal APIs".
Forced because the first screen has a derived value and someone will write it as an
effect that sets another signal.
*Tell:* an `effect()` whose body calls `.set()` on a signal; a signal that is only
ever written from inside an effect.
*Judge it:* `computed` is a formula cell in a spreadsheet: it recalculates itself and
cannot be typed into. `effect` is a macro that runs when cells change; using it to
copy one cell into another is where spreadsheets get circular references.
*Docs:* https://angular.dev/guide/signals/effect ·
https://angular.dev/guide/signals/linked-signal. **Answered** by the docs; the
interview confirms the project adopts it as written.

**3. How does async data reach a component: `resource()` / `httpResource()`, an observable turned into a signal, or a subscription? `[forced]`**
This is the Angular face of stack point 11 (how the client gets server data). Angular
22 offers `resource()` (a loader keyed on signal params, aborting stale loads, with
`idle/loading/resolved/error` status), `httpResource()` over `HttpClient`, `rxResource`
over an observable, and the older `HttpClient` + `toSignal` or `async` pipe. The docs
settle one half: "Avoid using `httpResource` for mutations like `POST` or `PUT`.
Instead, prefer directly using the underlying `HttpClient` APIs." They do not say which
read path a project should standardise on, and a typed RPC client (a `fetch`-based
promise) fits `resource()` but not `httpResource()`.
*Tell:* two read mechanisms in one feature; a component that both holds a `resource`
and subscribes to an observable for a second call; loading flags kept by hand next to
a resource that already has `isLoading()`.
*Judge it:* A resource is a self-updating fetch: give it the inputs, it refetches when
they change, tracks loading and error, and cancels the stale request. The trade-off is
that it is built for reads; writes (save, delete) still go through a plain call, so the
project must say which tool is the read path and which the write path.
*Docs:* https://angular.dev/guide/signals/resource ·
https://angular.dev/guide/http/http-resource ·
https://angular.dev/ecosystem/rxjs-interop. Answers mutations (plain client); **leaves
open** the read path.

## B. State and data flow

**4. Where does state live by scope: the component's own signals, a root service, a component-provided service, or a store? `[later]`**
The docs go exactly this far: "Use signals for local component state"; a service is
where "state management" is listed among the things services are for; providing a
service on a component "ties the instance of the service to the life of a component".
No page names a store or a state library, and none says when local state must be
promoted. Later because a first screen is local signals; the fork opens the day two
screens need the same value, and it is cheap to decide then and expensive after it has
been copied.
*Tell:* the same value fetched and held in two components; a root service that is a
grab bag of unrelated signals; a component reaching into a sibling's state through a
shared parent.
*Judge it:* State scope is who is allowed to see a value: only this box on screen, the
whole page, or the whole app. Narrow scope is simpler and dies with the screen; wide
scope survives navigation but must be reset by hand and can be changed from anywhere.
*Docs:* https://angular.dev/assets/context/best-practices.md ·
https://angular.dev/guide/di · https://angular.dev/guide/di/defining-dependency-providers.
Answers "local first, service for shared"; **leaves open** the promotion rule and
whether a store layer exists at all.

**5. Does a leaf component receive data only through inputs, or may it inject a service? `[forced]`**
Angular 22 does not use the words smart, container or presentational anywhere on
angular.dev (style guide, components guide and inputs guide checked). What it does say:
"Code inside your components and directives should generally relate to the UI shown on
the page", "For code that makes sense on its own, decoupled from the UI, prefer
refactoring to other files", "Keep components small and focused on a single
responsibility", and the component API is `input()`, `output()`, `model()` ("the
Angular team recommends using the signal-based `input` function for new projects").
Forced because the first screen already has a parent and a row, and the row either
takes an input or injects.
*Tell:* a row component that injects the same service its list parent already injected;
a leaf with no inputs whose template reads a service directly; an output emitted and
never listened to because the child also wrote the service.
*Judge it:* A leaf that only takes inputs is a pure function of what its parent hands
it: trivial to test and reuse, but every value must be threaded down. A leaf that
injects is self-sufficient but invisible to its parent and coupled to app state. The
project chooses the depth at which threading stops.
*Docs:* https://angular.dev/style-guide ·
https://angular.dev/guide/components/inputs ·
https://angular.dev/guide/components/outputs. Answers the API (signal inputs and
outputs); **leaves open** the injection boundary.

## C. Templates and components

**6. Which authoring defaults of Angular 22 does the project take as written? `[forced]`**
The docs prescribe a set that is not a fork any more, but a new project must not
re-decide it by accident: standalone components ("The Angular team recommends using
standalone components instead of NgModule for all new code", and `standalone: true`
must not be written since v20); `inject()` over constructor injection ("Prefer using the
`inject` function"); `input()`/`output()`/`model()` over decorators; the `host` object
over `@HostBinding`/`@HostListener`; `class`/`style` bindings over `NgClass`/`NgStyle`;
`@if`/`@for`/`@switch` over `*ngIf`/`*ngFor`; `@for` tracked by an identifier, not by
object reference; `protected` for template-only members and `readonly` for
Angular-initialised properties; `@Service` over `@Injectable({providedIn:'root'})` for
new root singletons, keeping `@Injectable` for constructor injection or
`useClass`/`useFactory`; inline templates for small components.
*Tell:* an `NgModule` in new code; `standalone: true` written out; `@Input()` next to
`input()` in one codebase; `*ngIf` and `@if` in one template.
*Judge it:* These are the framework's own current spellings of things it used to spell
another way. Mixing old and new is legal and costs nothing at runtime; it costs every
reader who must know both dialects. The only decision is whether legacy spellings are
banned or merely not introduced.
*Docs:* https://angular.dev/style-guide · https://angular.dev/guide/ngmodules/overview ·
https://angular.dev/guide/di/creating-and-using-services ·
https://angular.dev/guide/templates/control-flow ·
https://angular.dev/assets/context/best-practices.md. **Answered**; confirm and move on.
Most of these are lint-enforceable, which by the fifth filter makes them tool
configuration, not rules.

**7. What logic belongs in the template, and at what point does it move to the class? `[later]`**
Angular 22 moved control flow into the template (`@if`, `@for`, `@switch`, `@let`), and
the expression syntax forbids declarations, destructuring and `new`, so the language
itself caps template logic. The style guide gives the direction without the threshold:
"When the code in a template gets too complex, though, refactor logic into the
TypeScript code", and the best-practices file: "Keep templates simple and avoid complex
logic". Later because the threshold is discovered on the first template that reads
badly, and a rule written before that is a guess.
*Tell:* a template with a three-branch ternary inside an `@if`; a `computed()` that only
concatenates two strings the template could have; `@let` used to hide a chain of
method calls.
*Judge it:* A template is the description of the screen; the class is the logic behind
it. Logic in the template is visible where it is used but cannot be unit-tested or
named; logic in the class is testable but one hop away from the pixels.
*Docs:* https://angular.dev/style-guide · https://angular.dev/guide/templates/expression-syntax ·
https://angular.dev/guide/templates/variables. Answers direction; **leaves open** the
threshold.

## D. Forms

**8. Signal forms, reactive forms or template-driven forms for new forms? `[later]`**
Angular 22 has three form systems and describes their status three ways. The comparison
page: Signal Forms "Stable (v22+)", "Use Signal Forms if: You're building new
signal-based applications (Angular v22+)". The best-practices file: "Prefer Signal
Forms (`@angular/forms/signals`) for new forms. They are stable in Angular v22+", and
"When not using Signal Forms, prefer Reactive forms instead of Template-driven ones."
The signal-forms overview, though, reserves reactive forms for when you need
"production stability guarantees" and targets "Angular v21 or higher", and the forms
overview page still compares only reactive against template-driven. The migration
guide confirms the two can coexist (`compatForm`, `SignalFormControl`). Later because
the fork opens at the first form, and the answer is nearly dictated once it does.
*Tell:* `FormGroup` in one feature and `form()` in the next with no stated reason;
`ngModel` on a form that also has validators in the class.
*Judge it:* A form system decides where the form's values and validity live: in a
signal model the whole app already uses (signal forms), in a separate control tree
(reactive), or in the HTML alone (template-driven). One system per project is the
cheap choice; two is a permanent tax on every form reader.
*Docs:* https://angular.dev/guide/forms/signals/comparison ·
https://angular.dev/guide/forms/signals/overview ·
https://angular.dev/guide/forms/signals/migration · https://angular.dev/guide/forms.
**Answered** in the newest pages (signal forms for new code); the older pages have not
caught up, so confirm which page the project follows.

## E. Dependency injection

**9. Root singleton by default; when is a service provided on a component or a route instead? `[later]`**
The default is settled: `@Service` "makes this service available throughout your
entire application as a singleton. This is the recommended approach for most
services." The exceptions are named with their criteria: component `providers` for
"isolated instances" or "component-specific state", destroyed with the component;
route `providers` for "Feature-specific services" that "should only load with specific
features", visible to guards and resolvers; `viewProviders` to hide a service from
projected content. What no page says is which of a project's services fall on which
side, and that is where a wrong guess costs: a root singleton that should have been
per-component leaks one screen's state into the next. Later because the first
component-scoped service is the moment the criterion gets written.
*Tell:* a root service with a `reset()` called from `ngOnDestroy`; a service provided
on a component whose state is then also read through a parent.
*Judge it:* Provider scope is how many copies of a service exist and how long each
lives: one for the app, one per screen, or one per instance of a component. Fewer
copies means shared state for free; more copies means isolation for free. Each is the
other's bug.
*Docs:* https://angular.dev/guide/di/defining-dependency-providers ·
https://angular.dev/guide/di/hierarchical-dependency-injection ·
https://angular.dev/guide/di/creating-and-using-services. Answers the default and the
exception criteria; **leaves open** the classification. Related, docs-answered and
later: a service that "depends on a large library or rarely used feature" may be lazy
loaded with `injectAsync` (https://angular.dev/guide/di/lazy-loading-services).

## F. Change detection and rendering

**10. Zoneless and `OnPush` are the defaults; what is left to decide about change detection? `[forced]`**
"Zoneless is the default in Angular v21+" and "`ChangeDetectionStrategy.OnPush` is the
default strategy (since v22)"; the best-practices file says not to write either. In a
zoneless app the screen updates when a template-read signal changes, an input changes,
a bound listener runs, or something calls `markForCheck` (the `async` pipe does). Forced
because the bootstrap file must not re-add zone.js and components must not re-declare
the strategy; what remains open is narrow and arrives later: what to do with a value
that changes outside signals (a third-party callback, a raw subscription), and whether
opting a component back into `ChangeDetectionStrategy.Default` is ever allowed.
*Tell:* `provideZoneChangeDetection` in `app.config.ts`; `changeDetection: OnPush`
written on every component; a plain class field mutated from a callback and a
`markForCheck()` to make it show.
*Judge it:* Change detection is how the framework knows a screen is stale. Angular 22
only redraws when a signal, input or event says so; a value changed any other way is
invisible until the project either converts it to a signal or pokes the framework by
hand. The decision is which of those two is the house answer.
*Docs:* https://angular.dev/guide/zoneless ·
https://angular.dev/guide/components/advanced-configuration ·
https://angular.dev/assets/context/best-practices.md. **Answered** for the defaults;
the residual is open and later.

**11. Client-side rendering, server-side rendering or prerendering, and per route or for the whole app? `[forced]`**
The CLI asks at project creation and the answer shapes every component: with SSR,
code runs on a server first, so "Do not assume globals like (`new Date()`) are
available." The docs give criteria, not an answer: CSR is the default and suits
"dashboards, admin panels", "internal tools without SEO requirements", "single-page
applications with complex client-side state"; SSG "marketing and landing pages";
SSR "personalized content that changes frequently"; and strategies "can be applied
per route". Forced because switching later touches every component that reads
`window`, `document` or `localStorage`.
*Tell:* `window.` read at class-field initialisation in an SSR app; a
`resource()` given an `id` for user-specific data that then gets cached HTML
("Avoid setting `id` on resources that load data specific to the user").
*Judge it:* Rendering strategy is who draws the first paint: the browser after
downloading the app (simplest, worst for search engines and first-load speed), a
server per request (fast first paint, needs a server), or a build step ahead of time
(fastest, only for pages that are the same for everyone). It is a product question
before a technical one.
*Docs:* https://angular.dev/guide/routing/rendering-strategies ·
https://angular.dev/guide/signals/resource. **Leaves open**; the docs supply the
criteria only.

## G. Routing

**12. Which routes load lazily, and which views defer inside a page? `[forced]`**
Answered in one sentence: "In general, eager loading is recommended for primary
landing page(s) while other pages would be lazy-loaded", with the warning that "nested
lazy loading at multiple levels ... can significantly impact performance", and the
best-practices line "Implement lazy loading for feature routes". Forced because the
routes file is written on day one and `component:` versus `loadComponent:` is decided
per line. The within-page counterpart, `@defer`, is later: use it for "components not
needed for initial page render", never for what is in the viewport at load (layout
shift), and with different triggers on nested blocks.
*Tell:* every route on `component:`; a `loadChildren` under a `loadChildren` under a
`loadChildren`; a `@defer` around the hero of the landing page.
*Judge it:* Lazy loading splits the app's code so a screen's JavaScript is fetched only
when the user goes there. The landing page pays for eagerness with a bigger first
download; every other page pays for laziness with a small pause on first visit.
*Docs:* https://angular.dev/guide/routing/loading-strategies ·
https://angular.dev/guide/templates/defer. **Answered** for routes; `@defer` has criteria
but no default, so it stays open and later.

**13. Route-level data: params as component inputs or `ActivatedRoute`, and resolvers or fetch-in-component? `[forced]`**
Two halves. Reading params: the docs present `ActivatedRoute` subscriptions as the
primary example and `withComponentInputBinding()` "as an alternative", with no
preference stated; on the resolver page they add that input binding gives "better type
safety and eliminates the need to inject `ActivatedRoute` just to access resolved
data". Forced because `withComponentInputBinding()` is a bootstrap-time router flag
and the first routed screen reads a param. Resolvers: the docs list the benefit ("No
loading spinners for critical data", data present before render, "important for
SSR") and the cost ("Navigation is blocked while resolvers execute") and error handling
moves to router events; they recommend neither by default.
*Tell:* `ActivatedRoute` injected in one screen and `input.required()` for the same
param in another; a resolver that loads a whole list before a page whose header could
have rendered first; a route with `resolve:` and a `resource()` for the same data.
*Judge it:* A resolver fetches before the screen appears, so the user waits on the old
page and never sees an empty new one; fetching in the component shows the new page at
once with a loading state. Param binding is whether the URL's values arrive as plain
inputs (simple, typed) or through a router object the component must ask (flexible,
one more dependency).
*Docs:* https://angular.dev/guide/routing/read-route-state ·
https://angular.dev/guide/routing/data-resolvers ·
https://angular.dev/guide/routing/define-routes. **Leaves open** both halves.

## H. Testing

**14. Vitest is the runner; do component tests render the template or test the class? `[later]`**
"This guide covers the default testing setup for new Angular CLI projects, which uses
Vitest"; Karma "is still supported". That closes the runner. What the docs do not
address is the level: a component through `TestBed` with its template, the class
alone with its signals, or the screen through the browser. This is the Angular face
of stack point 15 and arrives with the first test that is painful to write.
*Tell:* a component spec that never renders and asserts on private fields; a
`TestBed` setup copied into forty specs; a service spec that boots the whole router.
*Judge it:* Rendering in a test proves the screen, at the price of a slower, more
fragile setup; testing the class proves the logic and cannot see the screen. The
project says which one a component earns by default.
*Docs:* https://angular.dev/guide/testing. Answers the runner; **leaves open** the
level.

---

## Using this catalogue

**bootstrap:** run it when the frontend tier is about to get real, after the stack
catalogue. Of the `[forced]` entries, 2, 6, 10 and 12 are confirm-only: read the
docs' answer back, get a yes, write nothing unless the project departs from it. Ask
1, 3, 5, 11 and 13. Expect two to four rules from this file, not fourteen.

**harvest:** read for the tells. Angular 22 codebases that grew through v17–v21 carry
both dialects of most of entry 6; whether that is a rule or a migration in progress is
the first thing to say.

**capture:** a decision on any of these lands in the project's conventions file under
its frontend heading, citing the angular.dev page above and "read against v22".
