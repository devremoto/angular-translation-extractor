import { Component } from '@angular/core';

@Component({
    selector: 'app-config',
    standalone: true,
    template: '<button (click)="deleteConfig()">Delete</button>'
})
export class ConfigComponent {

    deleteConfig() {
        if (confirm('Are you sure you want to delete this configuration?')) {
            console.log('Deleting configuration...');
            alert('Configuration deleted successfully!');
        } else {
            alert('Deletion cancelled');
        }
    }
}
