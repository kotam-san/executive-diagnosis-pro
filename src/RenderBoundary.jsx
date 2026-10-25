import { Component } from 'react'

export default class RenderBoundary extends Component {
  state = { failed: false, attempt: 0 }
  static getDerivedStateFromError() { return { failed: true } }
  retry = () => this.setState(state => ({ failed: false, attempt: state.attempt + 1 }))
  render() {
    if (this.state.failed) return <div role="alert" className="p-5 rounded-xl bg-amber-50 text-slate-800">
      <p>{this.props.message}</p>
      <button type="button" className="mt-3 underline font-bold" onClick={this.props.onRecover || this.retry}>
        {this.props.recoveryLabel || '表示をやり直す'}
      </button>
    </div>
    return <div key={this.state.attempt}>{this.props.children}</div>
  }
}
