const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const ethers = require('ethers');

const adminSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    walletAddress: {
        type: String,
        unique: true,
        lowercase: true,
        validate: {
            validator: function(v) {
                return !v || ethers.utils.isAddress(v); // Allow empty or valid address
            },
            message: props => `${props.value} is not a valid Ethereum address!`
        }
    },
    lastLogin: {
        type: Date
    }
}, {
    timestamps: true
});

// Indexes
adminSchema.index({ email: 1 }, { unique: true });
adminSchema.index({ walletAddress: 1 }, { unique: true });

// Pre-save middleware to hash password
adminSchema.pre('save', async function(next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }
    if (this.isModified('walletAddress')) {
        this.walletAddress = this.walletAddress.toLowerCase();
    }
    next();
});

// Methods
adminSchema.methods.comparePassword = async function(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

// Statics
adminSchema.statics.findByEmail = function(email) {
    return this.findOne({ email: email.toLowerCase() });
};

adminSchema.statics.findByWalletAddress = function(address) {
    return this.findOne({ walletAddress: address.toLowerCase() });
};

adminSchema.statics.adminExists = async function() {
    return (await this.countDocuments()) > 0;
};

const Admin = mongoose.model('Admin', adminSchema);

module.exports = Admin;
