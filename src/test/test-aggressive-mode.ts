import { extractFromJsTsContent } from '../extractJsTs';
import { RestrictedString } from '../types';

const sampleCode = `
@Component({
  selector: 'app-demo',
  template: '<div>Hello</div>'
})
export class DemoComponent {
  run() {
    showMessage('ok');
    showMessage('singlewordtoolong');
    showMessage('hello world');
    this.toastr.error('x');
    this.toastr.error('Hello user');
  }
}
`;

function run(mode: 'low' | 'moderate' | 'high') {
    const restricted: RestrictedString[] = [];
    const found = extractFromJsTsContent(
        sampleCode,
        'demo.ts',
        'demo.ts',
        2,
        [],
        mode,
        [],
        [],
        item => restricted.push(item)
    );

    return { mode, found: found.map(f => f.text), restricted: restricted.map(r => r.text) };
}

function main() {
    const low = run('low');
    const moderate = run('moderate');
    const high = run('high');

    console.log(JSON.stringify({ low, moderate, high }, null, 2));
}

main();
