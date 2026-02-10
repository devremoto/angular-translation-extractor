import { Component } from '@angular/core';

@Component({
    selector: 'app-test',
    standalone: true,
    template: '<div>Test</div>'
})
export class TestComponent {

    showMessage() {
        console.log("Hello World");
        alert("This is a test message");
        const greeting = "Welcome to the application";
        const errorMsg = "An error occurred";
        return "Success";
    }

    validateInput(value: string) {
        if (!value) {
            throw new Error("Value is required");
        }
        return "Valid input";
    }
}
