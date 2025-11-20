# API Documentation

## Overview
This document provides comprehensive documentation for the RESTful API endpoints of the Fusio Fantasy Game platform. The API is built using Express.js and follows RESTful design principles with JSON responses.

## API Base URL
```
Base URL: https://api.fusiofantasy.com/v1
```

## Authentication
All API endpoints require authentication using JWT tokens. Include the token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## Rate Limiting
- **Standard**: 100 requests per minute per IP
- **Authenticated**: 500 requests per minute per user

## Response Format
All responses follow a consistent JSON format:

```json
{
  "success": true,
  "data": { ... },
  "message": "Success message",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## API Endpoints

### Authentication Endpoints

#### POST /api/v1/auth/register
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123",
  "username": "fantasyuser"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "email": "user@example.com",
      "username": "fantasyuser",
      "createdAt": "2024-01-01T00:00:00.000Z"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### POST /api/v1/auth/login
Authenticate user and receive JWT token.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "email": "user@example.com",
      "username": "fantasyuser"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

#### POST /api/v1/auth/logout
Logout user and invalidate JWT token.

**Response:**
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### User Endpoints

#### GET /api/v1/users/profile
Get current user profile.

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "507f1f77bcf86cd799439011",
      "email": "user@example.com",
      "username": "fantasyuser",
      "balance": "1000",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

#### PUT /api/v1/users/profile
Update user profile.

**Request Body:**
```json
{
  "username": "newusername",
  "email": "newemail@example.com"
}
```

### Game Endpoints

#### GET /api/v1/games
Get list of games with pagination.

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)
- `status` (optional): Filter by game status

**Response:**
```json
{
  "success": true,
  "data": {
    "games": [
      {
        "id": "507f1f77bcf86cd799439011",
        "gameId": "GAME001",
        "name": "Fantasy Crypto Challenge",
        "description": "Test your crypto trading skills",
        "startTime": "2024-01-01T00:00:00.000Z",
        "endTime": "2024-01-01T23:59:59.000Z",
        "entryFee": "5",
        "status": "ACTIVE",
        "participantCount": 150,
        "totalPrizePool": "750"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 50,
      "pages": 3
    }
  }
}
```

#### GET /api/v1/games/:id
Get specific game details.

**Response:**
```json
{
  "success": true,
  "data": {
    "game": {
      "id": "507f1f77bcf86cd799439011",
      "gameId": "GAME001",
      "name": "Fantasy Crypto Challenge",
      "description": "Test your crypto trading skills",
      "startTime": "2024-01-01T00:00:00.000Z",
      "endTime": "2024-01-01T23:59:59.000Z",
      "entryFee": "5",
      "entryCap": 1000,
      "status": "ACTIVE",
      "participantCount": 150,
      "totalPrizePool": "750",
      "assets": [
        {
          "symbol": "BTC",
          "name": "Bitcoin",
          "price": "50000",
          "allocation": 25
        },
        {
          "symbol": "ETH",
          "name": "Ethereum",
          "price": "3000",
          "allocation": 25
        }
      ]
    }
  }
}
```

#### POST /api/v1/games
Create a new game (Admin only).

**Request Body:**
```json
{
  "name": "New Fantasy Game",
  "description": "Description of the game",
  "startTime": "2024-01-01T00:00:00.000Z",
  "endTime": "2024-01-01T23:59:59.000Z",
  "entryFee": 5,
  "entryCap": 1000,
  "assets": [
    {
      "symbol": "BTC",
      "allocation": 25
    },
    {
      "symbol": "ETH",
      "allocation": 25
    }
  ]
}
```

### Portfolio Endpoints

#### GET /api/v1/portfolios
Get user's portfolios.

**Response:**
```json
{
  "success": true,
  "data": {
    "portfolios": [
      {
        "id": "507f1f77bcf86cd799439011",
        "name": "My Crypto Portfolio",
        "gameId": "507f1f77bcf86cd799439011",
        "assets": [
          {
            "symbol": "BTC",
            "allocation": 50,
            "quantity": 0.1
          },
          {
            "symbol": "ETH",
            "allocation": 50,
            "quantity": 1.5
          }
        ],
        "totalValue": "5000",
        "status": "ACTIVE"
      }
    ]
  }
}
```

#### POST /api/v1/portfolios
Create a new portfolio.

**Request Body:**
```json
{
  "gameId": "507f1f77bcf86cd799439011",
  "name": "My Portfolio",
  "assets": [
    {
      "symbol": "BTC",
      "allocation": 50,
      "quantity": 0.1
    },
    {
      "symbol": "ETH",
      "allocation": 50,
      "quantity": 1.5
    }
  ]
}
```

### Transaction Endpoints

#### GET /api/v1/transactions
Get user's transaction history.

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 20)
- `type` (optional): Filter by transaction type

**Response:**
```json
{
  "success": true,
  "data": {
    "transactions": [
      {
        "id": "507f1f77bcf86cd799439011",
        "type": "ENTRY_FEE",
        "amount": "5",
        "status": "COMPLETED",
        "transactionHash": "0x123...",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 100,
      "pages": 5
    }
  }
}
```

### Admin Endpoints

#### GET /api/v1/admin/analytics
Get admin analytics dashboard data.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalUsers": 1000,
    "totalGames": 50,
    "totalTransactions": 5000,
    "totalRevenue": "25000",
    "activeGames": 10,
    "recentActivity": [
      {
        "type": "GAME_CREATED",
        "count": 5,
        "timestamp": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

## Error Handling

### Error Response Format
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": {
      "field": "email",
      "message": "Email is required"
    }
  }
}
```

### Common Error Codes
- `VALIDATION_ERROR`: Invalid request parameters
- `NOT_FOUND`: Resource not found
- `UNAUTHORIZED`: Authentication required
- `FORBIDDEN`: Insufficient permissions
- `RATE_LIMIT_EXCEEDED`: Too many requests

## Rate Limiting

### Rate Limit Headers
- `X-RateLimit-Limit`: Request limit per window
- `X-RateLimit-Remaining`: Remaining requests in current window
- `X-RateLimit-Reset`: Time when rate limit resets

## Pagination

### Pagination Parameters
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)
- `total`: Total items
- `pages`: Total pages

## Webhooks

### Webhook Endpoints
#### POST /api/v1/webhooks/game-completed
Receive notifications when a game is completed.

**Request Body:**
```json
{
  "gameId": "507f1f77bcf86cd799439011",
  "status": "COMPLETED",
  "winners": ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"]
}
```

## Testing

### Test Endpoints
#### GET /api/v1/test/health
Health check endpoint.

**Response:**
```json
{
  "success": true,
  "message": "API is healthy",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## SDK and Libraries

### Client Libraries
- **JavaScript/Node.js**: Official SDK available
- **Python**: Community SDK available
- **Postman**: Collection available for testing

### Postman Collection
Download the Postman collection from:
```
https://www.postman.com/collections/fusio-fantasy-api
```

## Support

### Contact Information
- **Email**: support@fusiofantasy.com
- **Discord**: https://discord.gg/fusiofantasy
- **Documentation**: https://docs.fusiofantasy.com

### API Support
- **Status Page**: https://status.fusiofantasy.com
- **Changelog**: https://docs.fusiofantasy.com/changelog
- **Support Ticket**: https://support.fusiofantasy.com
