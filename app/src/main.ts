import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { pwa } from './lib/pwa.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

pwa.register()

export default app
