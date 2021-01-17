import ViewPort from '../src/index.js'

window.ViewPort = ViewPort


const template = document.querySelector('#example');

class ExampleElement extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        
        this.shadowRoot.appendChild(template.content.cloneNode(true))
    }
}

customElements.define('example-element', ExampleElement);

new ViewPort(document.body.getElementsByTagName('example-element')[0]);
