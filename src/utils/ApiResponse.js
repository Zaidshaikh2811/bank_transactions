class ApiResponse {
    constructor(
        statusCode,
        message = "Success",
        data = null
    ) {
        this.success = true;
        this.statusCode = statusCode;
        this.message = message;
        this.data = data;
    }

    send(res) {
        return res
            .status(this.statusCode)
            .json(this);
    }
}

export default ApiResponse;