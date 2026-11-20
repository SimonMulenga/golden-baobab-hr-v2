import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { RotateCw } from 'lucide-react'

type Props = { children: ReactNode }
type State = { failed: boolean }

export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // The application currently has no authorized client-side error reporting service.
    // Avoid logging route data or employee details to the browser console.
  }

  render() {
    if (!this.state.failed) return this.props.children
    return <section className="route-error" role="alert">
      <span className="route-error-code">Screen unavailable</span>
      <h1>We couldn’t open this page</h1>
      <p>Your information is still protected. Try loading the screen again, or return to your overview.</p>
      <div className="route-error-actions">
        <button className="button-secondary" type="button" onClick={() => this.setState({ failed: false })}><RotateCw size={15}/> Try again</button>
        <Link className="button-primary" to="/">Return to overview</Link>
      </div>
    </section>
  }
}
