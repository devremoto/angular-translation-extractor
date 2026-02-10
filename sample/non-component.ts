import { Injectable } from '@angular/core';

// Regular service - NOT a @Component
@Injectable({
    providedIn: 'root'
})
export class DataService {

    getData() {
        console.log("This should NOT be extracted");
        return "Service data should NOT be extracted";
    }
}

// Regular class without any decorator
export class UtilityClass {

    getMessage() {
        return "This plain class string should NOT be extracted";
    }
}
